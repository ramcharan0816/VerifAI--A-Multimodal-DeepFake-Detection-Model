@echo off
echo =====================================================================
echo  VERIFAI - AI-Powered Deepfake Detection & Digital Media Verification
echo  Brand Identity: Emerald Trust / Midnight Cyber Intelligence
echo  Architecture: PyTorch MobileNetV3-Small (260x260 RGB) + FastAPI
echo =====================================================================
echo.
cd /d "%~dp0backend"
set USE_TF=0
set USE_TORCH=1
echo [1/3] Checking audio and video detector dependencies...
python -c "import importlib.util; assert importlib.util.find_spec('transformers') and importlib.util.find_spec('librosa')" >nul 2>&1
if errorlevel 1 (
    echo Installing audio and video detector dependencies...
    python -m pip install "transformers>=4.41.2,<5" "librosa>=0.10.2"
    if errorlevel 1 (
        echo Detector dependencies could not be installed. Check your internet connection and try again.
        pause
        exit /b 1
    )
)
echo [2/3] Initializing PyTorch model weights and test samples...
python init_model_and_samples.py
echo.
echo [3/3] Launching VerifAI FastAPI Forensic Server on http://localhost:8000 ...
python app.py
pause
