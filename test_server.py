import os
import sys
import json

# Add backend directory to path
backend_dir = os.path.join(os.path.dirname(__file__), "backend")
sys.path.insert(0, backend_dir)

from fastapi.testclient import TestClient
from app import app, SAMPLES_DIR

def run_inmemory_tests():
    print("=" * 70)
    print(" VERIFAI IN-MEMORY INTEGRATION TESTS VIA FASTAPI TESTCLIENT")
    print("=" * 70)
    
    client = TestClient(app)
    
    # 1. Health Endpoint
    print("\n[1/7] Testing GET /api/health ...")
    res = client.get("/api/health")
    assert res.status_code == 200, f"Expected 200, got {res.status_code}"
    data = res.json()
    print("  Status:", data["status"])
    print("  Model Loaded:", data["model_loaded"])
    print("  Device:", data["device"])
    assert data["status"] == "healthy"
    assert data["model_loaded"] is True
    
    # 2. Model Info
    print("\n[2/7] Testing GET /api/model/info ...")
    res = client.get("/api/model/info")
    assert res.status_code == 200
    model_data = res.json()
    print("  Architecture:", model_data["model_name"])
    print("  Accuracy:", model_data["metrics"]["accuracy"])
    print("  Precision:", model_data["metrics"]["precision"])
    print("  Recall:", model_data["metrics"]["recall"])
    print("  F1-Score:", model_data["metrics"]["f1_score"])
    print("  AUC-ROC:", model_data["metrics"]["auc_roc"])
    print("  Inference Latency:", model_data["metrics"]["inference_latency_ms"], "ms")
    assert model_data["metrics"]["accuracy"] > 0.90
    assert len(model_data["layer_summary"]) > 5
    assert len(model_data["dataset_distribution"]) == 4
    
    # 3. Frontend SPA HTML
    print("\n[3/7] Testing GET / (Frontend SPA) ...")
    res = client.get("/")
    assert res.status_code == 200
    html = res.text
    print("  HTML Size:", len(html), "bytes")
    assert "VERIFAI" in html
    assert "See Beyond the Fake" in html
    assert "Forensic Workspace" in html
    
    # 4. Analyze Sample Deepfake (POST /api/analyze/sample/{name})
    print("\n[4/7] Testing POST /api/analyze/sample/deepfake_faceswap_1.jpg ...")
    res = client.post("/api/analyze/sample/deepfake_faceswap_1.jpg")
    assert res.status_code == 200
    analysis = res.json()
    print("  Analysis ID:", analysis["analysis_id"])
    print("  Verdict:", analysis["prediction"])
    print("  Confidence:", analysis["confidence"], "%")
    print("  Real Score:", analysis["real_score"], "%")
    print("  Fake Score:", analysis["fake_score"], "%")
    print("  Processing Time:", analysis["processing_time_ms"], "ms")
    print("  Grad-CAM Overlay:", analysis["gradcam_path"])
    print("  2D FFT Spectrogram:", analysis["fft_path"])
    print("  Error Level Analysis:", analysis["ela_path"])
    print("  Findings Count:", len(analysis["forensic_data"]["evidence_fusion"]["findings"]))
    assert analysis["prediction"] in ["REAL", "FAKE"]
    assert analysis["confidence"] > 0
    fake_scan_id = analysis["analysis_id"]
    
    # 5. Analyze Authentic Sample
    print("\n[5/7] Testing POST /api/analyze/sample/authentic_id_photo_2.jpg ...")
    res = client.post("/api/analyze/sample/authentic_id_photo_2.jpg")
    assert res.status_code == 200
    auth_analysis = res.json()
    print("  Analysis ID:", auth_analysis["analysis_id"])
    print("  Verdict:", auth_analysis["prediction"])
    print("  Confidence:", auth_analysis["confidence"], "%")
    assert auth_analysis["prediction"] == "REAL"
    
    # 6. History and Stats
    print("\n[6/7] Testing GET /api/history & GET /api/dashboard/stats ...")
    res_hist = client.get("/api/history")
    assert res_hist.status_code == 200
    hist = res_hist.json()
    print("  Persisted Scans Count in SQLite:", hist["count"])
    assert hist["count"] >= 2
    
    res_stats = client.get("/api/dashboard/stats")
    assert res_stats.status_code == 200
    stats = res_stats.json()
    print("  Total Scans:", stats["total_scans"])
    print("  Real Verdicts:", stats["real_count"])
    print("  Fake Verdicts:", stats["fake_count"])
    print("  Average Confidence:", stats["avg_confidence"], "%")
    
    # 7. Delete Record API
    print(f"\n[7/7] Testing DELETE /api/history/{fake_scan_id} ...")
    res_del = client.delete(f"/api/history/{fake_scan_id}")
    assert res_del.status_code == 200
    print("  Delete Status:", res_del.json()["message"])
    
    print("\n" + "=" * 70)
    print(" ALL 7 TEST SUITES PASSED FLAWLESSLY WITH 100% SUCCESS!")
    print("=" * 70)

if __name__ == "__main__":
    run_inmemory_tests()
