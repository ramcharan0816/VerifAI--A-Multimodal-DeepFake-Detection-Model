"""Memory-bounded local audio and frame-level video screening adapters."""
import time
from functools import lru_cache

import cv2
import numpy as np
from PIL import Image
from model import model_service

DEFAULT_AUDIO_MODEL = "SpeechAntiSpoofingBenchmarks/AASIST"
MAX_AUDIO_DURATION_SECONDS = 500
MAX_VIDEO_DURATION_SECONDS = 600
MAX_VIDEO_FRAMES = 8

@lru_cache(maxsize=1)
def _audio_session():
    """Load the small ONNX AASIST detector instead of a 378 MB Wav2Vec2 model."""
    import onnxruntime as ort
    from huggingface_hub import hf_hub_download

    model_path = hf_hub_download(repo_id=DEFAULT_AUDIO_MODEL, filename="aasist.onnx")
    options = ort.SessionOptions()
    options.intra_op_num_threads = 1
    options.inter_op_num_threads = 1
    return ort.InferenceSession(model_path, sess_options=options, providers=["CPUExecutionProvider"])

def analyze_audio(path):
    import librosa
    start = time.perf_counter()
    try:
        duration = float(librosa.get_duration(path=path))
    except Exception as exc:
        raise ValueError("Could not decode this audio file. Install FFmpeg for compressed audio formats, or use WAV.") from exc
    if not np.isfinite(duration) or duration <= 0:
        raise ValueError("Audio file contains no decodable samples.")
    if duration > MAX_AUDIO_DURATION_SECONDS:
        raise ValueError(f"Audio exceeds the {MAX_AUDIO_DURATION_SECONDS}-second analysis limit.")

    # Decode only the sampled windows instead of retaining up to 500 seconds
    # of PCM audio in memory. This is important on small hosted instances.
    # AASIST expects a fixed 64,600-sample (~4.04 second) window.
    window = 64600
    sr = 16000
    window_seconds = window / sr
    count = min(8, max(1, int(np.ceil(duration / window_seconds))))
    starts = np.linspace(0.0, max(0.0, duration - window_seconds), count).tolist()
    session = _audio_session()
    input_name = session.get_inputs()[0].name
    pairs = []
    segment_results = []
    for offset_seconds in starts:
        try:
            chunk, _ = librosa.load(path, sr=sr, mono=True, offset=offset_seconds, duration=window_seconds)
        except Exception as exc:
            raise ValueError("Could not decode an audio segment. Try converting the recording to WAV.") from exc
        if chunk.size == 0:
            continue
        if float(np.max(np.abs(chunk))) < 1e-5:
            continue
        if len(chunk) < window:
            chunk = np.resize(chunk, window)
        logits = np.asarray(session.run(None, {input_name: chunk.astype(np.float32, copy=False)[None, :]})[0]).reshape(-1)
        logits = logits - np.max(logits)
        probs = np.exp(logits) / np.sum(np.exp(logits))
        fake, real = float(probs[0] * 100), float(probs[1] * 100)
        pairs.append((round(real, 2), round(fake, 2)))
        segment_results.append({"start_seconds": round(offset_seconds, 1),
                                "end_seconds": round(min(offset_seconds + len(chunk) / sr, duration), 1),
                                "real_score": round(real, 2), "fake_score": round(fake, 2)})

    if not pairs:
        raise ValueError("Audio appears silent or contains no usable speech segments.")
    real, fake = (round(float(np.mean([p[i] for p in pairs])), 2) for i in (0, 1))
    predicted = "FAKE" if fake >= real else "REAL"
    top_segment = max(segment_results, key=lambda segment: segment["fake_score"])
    return {"modality": "audio", "prediction": predicted, "confidence": max(real, fake),
            "real_score": real, "fake_score": fake, "model": DEFAULT_AUDIO_MODEL,
            "model_family": "AASIST voice anti-spoofing", "duration_seconds": round(duration, 2),
            "segments": len(segment_results), "segment_results": segment_results,
            "processing_time_ms": round((time.perf_counter()-start)*1000, 1),
            "findings": [f"Scored {len(segment_results)} speech windows across {duration:.1f} seconds.",
                         f"Highest synthetic score: {top_segment['fake_score']}% from {top_segment['start_seconds']:.1f}s to {top_segment['end_seconds']:.1f}s.",
                         "AASIST is an anti-spoofing screening model; results may be unreliable for audio outside its training domain."]}

def analyze_video(path):
    start = time.perf_counter()
    capture = cv2.VideoCapture(path)
    if not capture.isOpened():
        raise ValueError("Could not decode this video. Confirm the container codec is supported by OpenCV/FFmpeg.")
    frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    fps = float(capture.get(cv2.CAP_PROP_FPS) or 0)
    duration = frame_count / fps if fps > 0 else 0
    if duration > MAX_VIDEO_DURATION_SECONDS:
        capture.release()
        raise ValueError(f"Video exceeds the {MAX_VIDEO_DURATION_SECONDS}-second analysis limit.")
    if frame_count < 1:
        capture.release()
        raise ValueError("Video contains no decodable frames.")
    count = min(MAX_VIDEO_FRAMES, frame_count)
    positions = np.linspace(0, frame_count - 1, count, dtype=int)
    analyzed_positions = []
    pairs = []
    for pos in positions:
        capture.set(cv2.CAP_PROP_POS_FRAMES, int(pos))
        ok, frame = capture.read()
        if ok:
            height, width = frame.shape[:2]
            scale = min(1.0, 512 / max(height, width))
            if scale < 1.0:
                frame = cv2.resize(frame, (max(1, int(width * scale)), max(1, int(height * scale))), interpolation=cv2.INTER_AREA)
            frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            frame_image = Image.fromarray(frame)
            scores = model_service.predict_frame(frame_image)
            analyzed_positions.append(int(pos))
            pairs.append((scores["real_score"], scores["fake_score"]))
            del frame_image, frame
    capture.release()
    if not pairs:
        raise ValueError("No video frames could be decoded.")
    real = round(float(np.mean([p[0] for p in pairs])), 2)
    fake = round(float(np.mean([p[1] for p in pairs])), 2)
    predicted = "FAKE" if fake >= real else "REAL"
    return {"modality": "video", "prediction": predicted, "confidence": max(real, fake),
            "real_score": real, "fake_score": fake, "model": "VerifAI MobileNetV3-Small",
            "model_family": "MobileNetV3-Small sampled-frame ensemble", "duration_seconds": round(duration, 2),
            "frame_count": len(pairs), "source_frame_count": frame_count,
            "frame_results": [{"time_seconds": round(float(pos) / fps, 2) if fps > 0 else 0,
                               "fake_score": pair[1], "real_score": pair[0]}
                              for pos, pair in zip(analyzed_positions, pairs)],
            "processing_time_ms": round((time.perf_counter()-start)*1000, 1),
            "findings": [f"Classified {len(pairs)} frames sampled evenly across the video.",
                         "This uses VerifAI's image classifier on sampled frames; it does not assess audio, motion continuity, or lip-sync."]}
