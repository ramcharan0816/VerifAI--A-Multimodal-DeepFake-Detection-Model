"""Lazy local audio and frame-level video deepfake screening adapters.

Weights are downloaded from Hugging Face on first use and cached by Transformers.
Uploaded media is never sent to a hosted inference API.
"""
import os
import time
from functools import lru_cache

# This project runs Transformers through PyTorch. Avoid importing an optional,
# incompatible TensorFlow install while resolving the local classifier pipeline.
os.environ["USE_TF"] = "0"
os.environ["USE_TORCH"] = "1"

import cv2
import numpy as np
from PIL import Image

DEFAULT_AUDIO_MODEL = "MelodyMachine/Deepfake-audio-detection-V2"
DEFAULT_VIDEO_MODEL = "prithivMLmods/Deep-Fake-Detector-v2-Model"
MAX_AUDIO_DURATION_SECONDS = 500
MAX_VIDEO_DURATION_SECONDS = 600
MAX_VIDEO_FRAMES = 12

@lru_cache(maxsize=2)
def _pipeline(task, model_id):
    from transformers import pipeline
    return pipeline(task, model=model_id, device=0 if __import__("torch").cuda.is_available() else -1)

def _label_scores(outputs):
    scores = {str(item["label"]).lower(): float(item["score"]) for item in outputs}
    fake = next((v for k, v in scores.items() if any(w in k for w in ("fake", "spoof", "synthetic", "deepfake"))), None)
    real = next((v for k, v in scores.items() if any(w in k for w in ("real", "bonafide", "bona fide", "authentic"))), None)
    if fake is None and len(scores) == 2:
        # Common Hugging Face class convention for this checkpoint is LABEL_0=fake, LABEL_1=real.
        fake = scores.get("label_0")
        real = scores.get("label_1")
    if fake is None or real is None:
        raise RuntimeError(f"Model labels could not be mapped to REAL/FAKE: {sorted(scores)}")
    total = fake + real or 1.0
    return round(100 * real / total, 2), round(100 * fake / total, 2)

def analyze_audio(path):
    import librosa
    model_id = os.getenv("VERIFAI_AUDIO_MODEL", DEFAULT_AUDIO_MODEL)
    start = time.perf_counter()
    try:
        waveform, sr = librosa.load(path, sr=16000, mono=True)
    except Exception as exc:
        raise ValueError("Could not decode this audio file. Install FFmpeg for compressed audio formats, or use WAV.") from exc
    if waveform.size == 0:
        raise ValueError("Audio file contains no samples.")
    duration = len(waveform) / sr
    if duration > MAX_AUDIO_DURATION_SECONDS:
        raise ValueError(f"Audio exceeds the {MAX_AUDIO_DURATION_SECONDS}-second analysis limit.")
    if float(np.max(np.abs(waveform))) < 1e-5:
        raise ValueError("Audio appears silent; no speech can be assessed.")
    classifier = _pipeline("audio-classification", model_id)
    # Score overlapping 5-second windows across the full recording, then average probabilities.
    window = 5 * sr
    hop = 4 * sr
    starts = list(range(0, max(1, len(waveform) - window + 1), hop))
    chunks = [waveform[i:i + window] for i in starts]
    if len(waveform) < window:
        starts = [0]
        chunks = [waveform]
    if len(chunks) > 45:
        indices = np.linspace(0, len(chunks) - 1, 45, dtype=int)
        chunks = [chunks[i] for i in indices]
        starts = [starts[i] for i in indices]
    pairs = [_label_scores(classifier({"array": chunk, "sampling_rate": sr}, top_k=None)) for chunk in chunks]
    real, fake = (round(float(np.mean([p[i] for p in pairs])), 2) for i in (0, 1))
    predicted = "FAKE" if fake >= real else "REAL"
    segment_results = [{"start_seconds": round(offset / sr, 1), "end_seconds": round(min(offset + len(chunk), len(waveform)) / sr, 1),
                        "real_score": pair[0], "fake_score": pair[1]}
                       for offset, chunk, pair in zip(starts, chunks, pairs)]
    top_segment = max(segment_results, key=lambda segment: segment["fake_score"])
    return {"modality": "audio", "prediction": predicted, "confidence": max(real, fake),
            "real_score": real, "fake_score": fake, "model": model_id,
            "model_family": "Wav2Vec2 audio classification", "duration_seconds": round(duration, 2),
            "segments": len(chunks), "segment_results": segment_results,
            "processing_time_ms": round((time.perf_counter()-start)*1000, 1),
            "findings": [f"Scored {len(chunks)} overlapping speech windows across {duration:.1f} seconds.",
                         f"Highest synthetic score: {top_segment['fake_score']}% from {top_segment['start_seconds']:.1f}s to {top_segment['end_seconds']:.1f}s.",
                         "Model was trained for synthetic/spoofed speech screening; it does not detect every kind of audio edit."]}

def analyze_video(path):
    model_id = os.getenv("VERIFAI_VIDEO_FRAME_MODEL", DEFAULT_VIDEO_MODEL)
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
    frames = []
    for pos in positions:
        capture.set(cv2.CAP_PROP_POS_FRAMES, int(pos))
        ok, frame = capture.read()
        if ok:
            frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            frames.append(Image.fromarray(frame))
    capture.release()
    if not frames:
        raise ValueError("No video frames could be decoded.")
    classifier = _pipeline("image-classification", model_id)
    pairs = [_label_scores(classifier(frame, top_k=None)) for frame in frames]
    real = round(float(np.mean([p[0] for p in pairs])), 2)
    fake = round(float(np.mean([p[1] for p in pairs])), 2)
    predicted = "FAKE" if fake >= real else "REAL"
    return {"modality": "video", "prediction": predicted, "confidence": max(real, fake),
            "real_score": real, "fake_score": fake, "model": model_id,
            "model_family": "Vision Transformer (ViT), sampled-frame ensemble", "duration_seconds": round(duration, 2),
            "frame_count": len(frames), "source_frame_count": frame_count,
            "frame_results": [{"time_seconds": round(float(pos) / fps, 2) if fps > 0 else 0,
                               "fake_score": pair[1], "real_score": pair[0]}
                              for pos, pair in zip(positions, pairs)],
            "processing_time_ms": round((time.perf_counter()-start)*1000, 1),
            "findings": [f"Classified {len(frames)} frames sampled evenly across the video.",
                         "This is a frame-level image model applied to sampled frames; it does not assess audio, motion continuity, or lip-sync."]}
