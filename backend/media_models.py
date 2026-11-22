"""Memory-bounded local audio and frame-level video screening adapters."""
import time
import re
import subprocess
from functools import lru_cache
from mutagen import File as MutagenFile

import cv2
import numpy as np
from PIL import Image
from model import model_service

DEFAULT_AUDIO_MODEL = "SpeechAntiSpoofingBenchmarks/AASIST"
MAX_AUDIO_DURATION_SECONDS = 500
MAX_VIDEO_DURATION_SECONDS = 600
MAX_VIDEO_FRAMES = 8

@lru_cache(maxsize=1)
def _audio_model():
    """Load the 0.3M-parameter AASIST model in the already-used PyTorch runtime."""
    from huggingface_hub import hf_hub_download
    import torch
    from aasist_arch import Model

    model_path = hf_hub_download(repo_id=DEFAULT_AUDIO_MODEL, filename="AASIST.pth")
    model_config = {
        "nb_samp": 64600,
        "first_conv": 128,
        "filts": [70, [1, 32], [32, 32], [32, 64], [64, 64]],
        "gat_dims": [64, 32],
        "pool_ratios": [0.5, 0.7, 0.5, 0.5],
        "temperatures": [2.0, 2.0, 100.0, 100.0],
    }
    model = Model(model_config)
    state_dict = torch.load(model_path, map_location="cpu", weights_only=True)
    if isinstance(state_dict, dict) and "state_dict" in state_dict:
        state_dict = state_dict["state_dict"]
    if state_dict and next(iter(state_dict)).startswith("module."):
        state_dict = {key.removeprefix("module."): value for key, value in state_dict.items()}
    model.load_state_dict(state_dict)
    model.eval()
    return model

def _audio_duration(path, ffmpeg):
    try:
        media = MutagenFile(path)
    except Exception:
        media = None
    duration = getattr(getattr(media, "info", None), "length", None)
    if duration and duration > 0:
        return float(duration)

    # Some containers do not expose duration through Mutagen. Ask FFmpeg to
    # inspect the header; the expected no-output error is ignored.
    result = subprocess.run([ffmpeg, "-hide_banner", "-i", path], capture_output=True, text=True, check=False)
    match = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", result.stderr)
    if not match:
        raise ValueError("Could not read the audio duration. Try converting the recording to WAV.")
    hours, minutes, seconds = match.groups()
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds)

def _decode_audio_window(path, ffmpeg, offset_seconds, duration_seconds):
    result = subprocess.run(
        [ffmpeg, "-v", "error", "-threads", "1", "-ss", str(offset_seconds), "-i", path,
         "-t", str(duration_seconds), "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", "pipe:1"],
        capture_output=True,
        check=False,
    )
    if result.returncode != 0 or not result.stdout:
        raise ValueError("Could not decode an audio segment. Try converting the recording to WAV.")
    return np.frombuffer(result.stdout, dtype="<f4")

def analyze_audio(path):
    import imageio_ffmpeg
    start = time.perf_counter()
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    duration = _audio_duration(path, ffmpeg)
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
    model = _audio_model()
    import torch
    pairs = []
    segment_results = []
    for offset_seconds in starts:
        try:
            chunk = _decode_audio_window(path, ffmpeg, offset_seconds, window_seconds)
        except ValueError:
            raise
        except Exception as exc:
            raise ValueError("Could not decode an audio segment. Try converting the recording to WAV.") from exc
        if chunk.size == 0:
            continue
        if float(np.max(np.abs(chunk))) < 1e-5:
            continue
        if len(chunk) < window:
            chunk = np.resize(chunk, window)
        else:
            chunk = chunk[:window]
        input_tensor = torch.from_numpy(chunk.astype(np.float32, copy=False)[None, :])
        with torch.no_grad():
            _, logits = model(input_tensor)
            probs = torch.softmax(logits, dim=1)[0].cpu().numpy()
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
