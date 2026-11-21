import os
import sys
import asyncio

backend_dir = os.path.join(os.path.dirname(__file__), "backend")
sys.path.insert(0, backend_dir)

import app

async def test_all():
    print("=" * 65)
    print(" VERIFAI DIRECT ASYNC API ENDPOINT VERIFICATION")
    print("=" * 65)
    
    # 1. Health
    print("\n[1/6] Testing health_check() ...")
    health = await app.health_check()
    print("  Health result:", health)
    assert health["status"] == "healthy"
    assert health["model_loaded"] is True
    
    # 2. Model info
    print("\n[2/6] Testing model_info() ...")
    info = await app.model_info()
    print("  Model:", info["model_name"])
    print("  Accuracy:", info["metrics"]["accuracy"])
    print("  AUC-ROC:", info["metrics"]["auc_roc"])
    print("  Confusion matrix:", info["confusion_matrix"])
    assert info["metrics"]["accuracy"] > 0.90
    
    # 3. Dashboard stats
    print("\n[3/6] Testing dashboard_stats() ...")
    stats = await app.dashboard_stats()
    print("  Total scans:", stats["total_scans"])
    print("  Real count:", stats["real_count"])
    print("  Fake count:", stats["fake_count"])
    
    # 4. Analyze Sample Deepfake
    print("\n[4/6] Testing analyze_sample('deepfake_faceswap_1.jpg') ...")
    res_fake = await app.analyze_sample("deepfake_faceswap_1.jpg")
    print("  ID:", res_fake["analysis_id"])
    print("  Verdict:", res_fake["prediction"])
    print("  Confidence:", res_fake["confidence"], "%")
    print("  Real Score:", res_fake["real_score"], "%")
    print("  Fake Score:", res_fake["fake_score"], "%")
    print("  Grad-CAM URL:", res_fake["gradcam_path"])
    print("  FFT URL:", res_fake["fft_path"])
    assert res_fake["prediction"] in ["REAL", "FAKE"]
    
    # 5. Analyze Sample Authentic
    print("\n[5/6] Testing analyze_sample('authentic_id_photo_2.jpg') ...")
    res_real = await app.analyze_sample("authentic_id_photo_2.jpg")
    print("  ID:", res_real["analysis_id"])
    print("  Verdict:", res_real["prediction"])
    print("  Confidence:", res_real["confidence"], "%")
    assert res_real["prediction"] == "REAL"
    
    # 6. History query & delete
    print("\n[6/6] Testing get_history() and delete_single_history() ...")
    hist = await app.get_history()
    print("  History count:", hist["count"])
    assert hist["count"] >= 2
    del_res = await app.delete_single_history(res_fake["analysis_id"])
    print("  Deleted record:", del_res["message"])
    
    print("\n" + "=" * 65)
    print(" ALL API VERIFICATIONS COMPLETED WITH 100% SUCCESS!")
    print("=" * 65)

if __name__ == "__main__":
    asyncio.run(test_all())
