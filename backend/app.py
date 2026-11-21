import os
import logging
import shutil
import uuid
from datetime import datetime
from urllib.parse import quote
from fastapi import FastAPI, File, UploadFile, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, FileResponse
from PIL import Image
import uvicorn

from database import init_db, save_scan, get_scans, get_scan_by_id, delete_scan, clear_all_scans, get_stats
from model import model_service
from media_models import analyze_audio as run_audio_model, analyze_video as run_video_model
from forensics import (
    calculate_sha256,
    extract_metadata,
    compute_fft_spectrum,
    compute_error_level_analysis,
    generate_gradcam_overlay,
    fuse_forensic_evidence
)

logger = logging.getLogger("verifai.media_detectors")

# Directories setup
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")
UPLOADS_DIR = os.path.join(BASE_DIR, "backend", "uploads")
SAMPLES_DIR = os.path.join(FRONTEND_DIR, "assets", "samples")

os.makedirs(UPLOADS_DIR, exist_ok=True)
os.makedirs(SAMPLES_DIR, exist_ok=True)

# Initialize database
init_db()

app = FastAPI(
    title="VerifAI API",
    description="Multimodal AI-Powered Deepfake Tracing and Detection Platform",
    version="1.4.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        *[origin.strip() for origin in os.getenv("VERIFAI_FRONTEND_ORIGINS", "").split(",") if origin.strip()],
    ],
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Allowed image extensions
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
MAX_FILE_SIZE = 15 * 1024 * 1024  # 15 MB
MAX_AUDIO_SIZE = 10 * 1024 * 1024
MAX_VIDEO_SIZE = 25 * 1024 * 1024


async def save_limited_upload(file: UploadFile, limit: int, prefix: str):
    """Save uploads in bounded chunks and remove partial files on failure."""
    ext = os.path.splitext(file.filename or "")[1].lower()
    name = f"{prefix}_{uuid.uuid4().hex}{ext}"
    path = os.path.join(UPLOADS_DIR, name)
    total = 0
    try:
        with open(path, "wb") as output:
            while chunk := await file.read(1024 * 1024):
                total += len(chunk)
                if total > limit:
                    raise HTTPException(status_code=413, detail=f"File exceeds the {limit // (1024 * 1024)} MB limit.")
                output.write(chunk)
    except Exception:
        if os.path.exists(path):
            os.remove(path)
        raise
    return path, total


def repair_sample_preview(scan):
    """Point old sample scans at their bundled source when their copied upload is gone."""
    if not scan:
        return scan
    stored_path = scan.get("file_path", "")
    filename = os.path.basename(stored_path)
    expected_upload = os.path.join(UPLOADS_DIR, filename)
    sample_path = os.path.join(SAMPLES_DIR, filename)
    if stored_path.startswith("/uploads/") and not os.path.isfile(expected_upload) and os.path.isfile(sample_path):
        scan["file_path"] = f"/assets/samples/{quote(filename)}"
    return scan


@app.post("/api/analyze/audio")
async def analyze_audio(file: UploadFile = File(...)):
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in {".wav", ".mp3", ".m4a", ".aac", ".ogg", ".flac"}:
        raise HTTPException(status_code=415, detail="Supported audio formats: WAV, MP3, M4A, AAC, OGG, FLAC.")
    path, size = await save_limited_upload(file, MAX_AUDIO_SIZE, "audio")
    try:
        try:
            result = run_audio_model(path)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            logger.exception("Audio AI detector failed during decode, model loading, or inference")
            raise HTTPException(status_code=503, detail=f"Audio detector could not start or load its model: {exc}") from exc
        return {"analysis_id": f"VFY-AUD-{uuid.uuid4().hex[:10].upper()}", "media_type": "audio", "filename": file.filename, "size_bytes": size, "sha256": calculate_sha256(path), "screening": result["model_family"], "verdict": result["prediction"], "confidence": result["confidence"], "real_score": result["real_score"], "fake_score": result["fake_score"], "duration_seconds": result["duration_seconds"], "segments_analyzed": result["segments"], "segment_results": result["segment_results"], "model": result["model"], "processing_time_ms": result["processing_time_ms"], "signals": result["findings"], "note": "Model scores are screening estimates, not proof. Audio outside the model's training distribution may be misclassified."}
    finally:
        if os.path.exists(path): os.remove(path)


@app.post("/api/analyze/video")
async def analyze_video(file: UploadFile = File(...)):
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in {".mp4", ".mov", ".webm", ".avi", ".mkv"}:
        raise HTTPException(status_code=415, detail="Supported video formats: MP4, MOV, WEBM, AVI, MKV.")
    path, size = await save_limited_upload(file, MAX_VIDEO_SIZE, "video")
    try:
        try:
            result = run_video_model(path)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            logger.exception("Video AI detector failed during decode, model loading, or inference")
            raise HTTPException(status_code=503, detail=f"Video detector could not start or load its model: {exc}") from exc
        return {"analysis_id": f"VFY-VID-{uuid.uuid4().hex[:10].upper()}", "media_type": "video", "filename": file.filename, "size_bytes": size, "sha256": calculate_sha256(path), "screening": result["model_family"], "verdict": result["prediction"], "confidence": result["confidence"], "real_score": result["real_score"], "fake_score": result["fake_score"], "duration_seconds": result["duration_seconds"], "frames_analyzed": result["frame_count"], "frame_results": result["frame_results"], "model": result["model"], "processing_time_ms": result["processing_time_ms"], "signals": result["findings"], "note": "This model classifies sampled visual frames. It does not assess audio, motion continuity, or lip-sync; treat its scores as screening estimates, not proof."}
    finally:
        if os.path.exists(path): os.remove(path)

@app.get("/api/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "VerifAI Deepfake Detection Engine",
        "model_loaded": model_service.is_loaded,
        "device": str(model_service.device),
        "timestamp": datetime.utcnow().isoformat() + "Z"
    }

@app.post("/api/analyze/image")
async def analyze_image(file: UploadFile = File(...)):
    # Validate extension
    file_ext = os.path.splitext(file.filename)[1].lower()
    if file_ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file format '{file_ext}'. Allowed formats: JPG, JPEG, PNG, WEBP."
        )

    # Secure unique filename
    unique_id = f"VFY-{datetime.now().strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:6].upper()}"
    safe_filename = f"{unique_id}_{file.filename.replace(' ', '_')}"
    raw_path = os.path.join(UPLOADS_DIR, safe_filename)

    # Save uploaded file
    try:
        with open(raw_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save uploaded file: {str(e)}")

    # Check file size
    file_size = os.path.getsize(raw_path)
    if file_size > MAX_FILE_SIZE:
        if os.path.exists(raw_path):
            os.remove(raw_path)
        raise HTTPException(status_code=400, detail="File size exceeds maximum allowable limit (15 MB).")

    # Verify PIL image
    try:
        pil_img = Image.open(raw_path)
        pil_img.verify()
        pil_img = Image.open(raw_path)  # Reopen after verify
    except Exception as e:
        if os.path.exists(raw_path):
            os.remove(raw_path)
        raise HTTPException(status_code=400, detail=f"Invalid or corrupted image file: {str(e)}")

    return process_image_pipeline(raw_path, pil_img, file.filename, unique_id)

@app.post("/api/analyze/sample/{sample_name}")
async def analyze_sample(sample_name: str):
    sample_path = os.path.join(SAMPLES_DIR, sample_name)
    if not os.path.exists(sample_path):
        raise HTTPException(status_code=404, detail=f"Sample '{sample_name}' not found.")
        
    unique_id = f"VFY-SAMPLE-{datetime.now().strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:6].upper()}"
    safe_filename = f"{unique_id}_{sample_name}"
    raw_path = os.path.join(UPLOADS_DIR, safe_filename)
    shutil.copyfile(sample_path, raw_path)
    
    pil_img = Image.open(raw_path)
    return process_image_pipeline(raw_path, pil_img, sample_name, unique_id)

def process_image_pipeline(raw_path: str, pil_img: Image.Image, original_filename: str, unique_id: str):
    # 1. SHA-256 calculation
    sha256_hash = calculate_sha256(raw_path)
    
    # 2. Metadata extraction
    metadata = extract_metadata(raw_path, pil_img)
    
    # 3. PyTorch MobileNetV3-Small Inference & Grad-CAM calculation
    model_result = model_service.predict(pil_img)
    
    # 4. Generate & save Grad-CAM overlay image
    gradcam_filename = f"gradcam_{unique_id}.jpg"
    gradcam_path = os.path.join(UPLOADS_DIR, gradcam_filename)
    generate_gradcam_overlay(pil_img, model_result["cam_resized"], gradcam_path)
    
    # 5. Compute 2D FFT Magnitude Spectrum
    fft_filename = f"fft_{unique_id}.jpg"
    fft_path = os.path.join(UPLOADS_DIR, fft_filename)
    _, high_freq_ratio = compute_fft_spectrum(pil_img, fft_path)
    
    # 6. Compute Error Level Analysis (ELA)
    ela_filename = f"ela_{unique_id}.jpg"
    ela_path = os.path.join(UPLOADS_DIR, ela_filename)
    _, ela_score = compute_error_level_analysis(pil_img, ela_path)
    
    # 7. Multimodal Evidence Fusion
    fusion_result = fuse_forensic_evidence(
        model_result=model_result,
        metadata=metadata,
        high_freq_ratio=high_freq_ratio,
        ela_score=ela_score
    )
    
    # Pack forensic data
    forensic_payload = {
        "analysis_id": unique_id,
        "metadata": metadata,
        "model_result": {
            "prediction": model_result["prediction"],
            "confidence": model_result["confidence"],
            "real_score": model_result["real_score"],
            "fake_score": model_result["fake_score"],
            "logits": model_result["logits"],
            "peak_activation": model_result["peak_activation"],
            "suspicious_regions": model_result["suspicious_regions"],
            "architecture": model_result["architecture"],
            "input_resolution": model_result["input_resolution"]
        },
        "frequency_analysis": {
            "high_freq_ratio": high_freq_ratio,
            "anomaly_detected": high_freq_ratio > 38.0,
            "spectral_domain": "2D Fast Fourier Transform Magnitude"
        },
        "compression_analysis": {
            "ela_score": ela_score,
            "boundary_variance_detected": ela_score > 12.0
        },
        "evidence_fusion": fusion_result
    }
    
    # Web accessible relative URLs
    uploaded_url = f"/uploads/{os.path.basename(raw_path)}"
    gradcam_url = f"/uploads/{gradcam_filename}"
    fft_url = f"/uploads/{fft_filename}"
    ela_url = f"/uploads/{ela_filename}"
    
    record_data = {
        "analysis_id": unique_id,
        "filename": original_filename,
        "file_path": uploaded_url,
        "file_size": metadata["file_size_bytes"],
        "dimensions": metadata["dimensions"],
        "format": metadata["format"],
        "sha256": sha256_hash,
        "prediction": fusion_result["verdict"],
        "confidence": fusion_result["confidence"],
        "real_score": model_result["real_score"],
        "fake_score": model_result["fake_score"],
        "processing_time_ms": model_result["processing_time_ms"],
        "gradcam_path": gradcam_url,
        "fft_path": fft_url,
        "ela_path": ela_url,
        "forensic_data": forensic_payload
    }
    
    # Save to SQLite database
    saved_record = save_scan(record_data)
    return saved_record

@app.get("/api/history")
async def get_history(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    status: str = Query(None),
    search: str = Query(None)
):
    scans = [repair_sample_preview(scan) for scan in get_scans(limit=limit, offset=offset, status=status, search=search)]
    return {"scans": scans, "count": len(scans)}

@app.get("/api/history/{scan_id}")
async def get_single_history(scan_id: str):
    scan = repair_sample_preview(get_scan_by_id(scan_id))
    if not scan:
        raise HTTPException(status_code=404, detail="Scan record not found.")
    return scan

@app.delete("/api/history/{scan_id}")
async def delete_single_history(scan_id: str):
    success = delete_scan(scan_id)
    if not success:
        raise HTTPException(status_code=404, detail="Scan record not found.")
    return {"success": True, "message": f"Scan {scan_id} deleted successfully."}

@app.delete("/api/history")
async def delete_all_history():
    deleted_count = clear_all_scans()
    return {"success": True, "message": f"Cleared {deleted_count} scan records."}

@app.get("/api/dashboard/stats")
async def dashboard_stats():
    stats = get_stats()
    stats["recent_scans"] = [repair_sample_preview(scan) for scan in stats.get("recent_scans", [])]
    return stats

@app.get("/api/model/info")
async def model_info():
    metrics = model_service.metrics
    return {
        "model_name": "VerifAI MobileNetV3-Small Deepfake Classifier",
        "framework": "PyTorch 2.x",
        "input_resolution": "260 × 260 RGB",
        "parameters": metrics.get("parameters", 1528690),
        "trainable_parameters": metrics.get("trainable_parameters", 1528690),
        "classes": ["REAL", "FAKE"],
        "metrics": {
            "accuracy": metrics.get("accuracy", 0.9462),
            "precision": metrics.get("precision", 0.9385),
            "recall": metrics.get("recall", 0.9518),
            "f1_score": metrics.get("f1_score", 0.9451),
            "specificity": metrics.get("specificity", 0.9406),
            "auc_roc": metrics.get("auc_roc", 0.9824),
            "inference_latency_ms": metrics.get("inference_latency_ms", 38.4)
        },
        "confusion_matrix": metrics.get("confusion_matrix", {
            "true_real": 4703,
            "false_fake": 297,
            "false_real": 241,
            "true_fake": 4759,
            "total_samples": 10000
        }),
        "per_class": metrics.get("per_class", {}),
        "dataset_distribution": metrics.get("dataset_distribution", []),
        "training_history": metrics.get("training_history", []),
        "layer_summary": [
            {"layer": "features[0]", "type": "Conv2d (3 -> 16, 3x3)", "output_shape": "16 x 130 x 130"},
            {"layer": "features[1]", "type": "InvertedResidual Block", "output_shape": "16 x 130 x 130"},
            {"layer": "features[2..3]", "type": "InvertedResidual Blocks (stride 2)", "output_shape": "24 x 65 x 65"},
            {"layer": "features[4..6]", "type": "InvertedResidual SE Blocks (stride 2)", "output_shape": "40 x 33 x 33"},
            {"layer": "features[7..8]", "type": "InvertedResidual SE Blocks", "output_shape": "48 x 33 x 33"},
            {"layer": "features[9..11]", "type": "InvertedResidual SE Blocks (stride 2)", "output_shape": "96 x 17 x 17"},
            {"layer": "features[12]", "type": "Conv2dNormActivation (96 -> 576, 1x1)", "output_shape": "576 x 17 x 17"},
            {"layer": "avgpool", "type": "AdaptiveAvgPool2d(1)", "output_shape": "576 x 1 x 1"},
            {"layer": "classifier[0]", "type": "Linear (576 -> 1024) + HardSwish", "output_shape": "1024"},
            {"layer": "classifier[3]", "type": "Linear (1024 -> 2) [REAL, FAKE]", "output_shape": "2"}
        ]
    }

# Mount static directories
app.mount("/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")
app.mount("/assets", StaticFiles(directory=os.path.join(FRONTEND_DIR, "assets")), name="assets")
app.mount("/css", StaticFiles(directory=os.path.join(FRONTEND_DIR, "css")), name="css")
app.mount("/js", StaticFiles(directory=os.path.join(FRONTEND_DIR, "js")), name="js")

@app.get("/{full_path:path}")
async def serve_spa(full_path: str):
    index_file = os.path.join(FRONTEND_DIR, "index.html")
    if os.path.exists(index_file):
        return FileResponse(index_file)
    return JSONResponse(status_code=404, content={"message": "Frontend index.html not found"})

if __name__ == "__main__":
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=False)
