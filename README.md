
# VERIFAI — AI-Powered Deepfake Detection 

> **"See Beyond the Fake."**  
> *Intelligent Media Verification & Multimodal Forensic Analysis*

---

## 🛡️ Project Overview

**VerifAI** is a multimodal media detection platform for images, audio, and video. It analyzes images with MobileNetV3 and forensic evidence fusion, screens audio with AASIST, and classifies sampled video frames with the resident MobileNetV3 model.

Built with a **FastAPI** backend, **PyTorch MobileNetV3-Small** convolutional neural network (processing **260 × 260 RGB** tensors), and a **SQLite** persistent audit database, VerifAI unifies deep learning inference with explainable artificial intelligence (Grad-CAM), 2D Fourier frequency domain analysis, Error Level Analysis (ELA), and an Evidence Fusion Engine.

---

## 🎨 Design Identity: Emerald Trust / Midnight Cyber Intelligence

The visual identity is modeled after sophisticated cybersecurity operations centers:

| Color Role | Hex Code | Usage |
| :--- | :--- | :--- |
| **Forest** | `#123B2E` | Primary application background |
| **Deep Forest** | `#102B24` | Hero banners, sidebar, and headers |
| **Emerald** | `#087A55` | Primary action buttons and badges |
| **Rich Emerald** | `#176B50` | Interactive hover states |
| **Mint** | `#65C9A5` | Cyber highlights, accents, and radar pulses |
| **Soft Mint** | `#B9E4D2` | Secondary accents and metrics |
| **Champagne** | `#D8C39A` | Premium metadata badges and forensic details |
| **Ivory** | `#F5F1E8` | High-contrast typography and titles |
| **Card Green** | `#19382D` | Forensic dashboard cards |
| **Border Green** | `#315344` | Card borders and divider lines |
| **Muted Text** | `#A8BDB1` | Secondary text and labels |
| **REAL Status** | `#22A879` | Authentic media indicator |
| **FAKE Status** | `#D94B55` | Manipulated media warning |

---

## 🧠 Model Architecture & Forensic Engine

- **Base Architecture**: PyTorch `MobileNetV3-Small`
- **Parameter Count**: 1,528,690 parameters
- **Input Resolution**: `260 × 260 × 3` (RGB), normalized to ImageNet distribution
- **Latent Feature Extractor**: 12 Inverted Residual Blocks with Squeeze-and-Excitation (SE) attention and Hard-Swish activations
- **Explainability**: Authentic Gradient-weighted Class Activation Mapping (Grad-CAM) computed on `model.features[-1]`
- **Frequency Domain**: 2D Fast Fourier Transform (FFT) magnitude spectrum highlighting checkerboard upsampler grids
- **Compression Artifacts**: Error Level Analysis (ELA) measuring JPEG compression differential
- **Video screening**: up to eight sampled frames classified with MobileNetV3; audio and temporal consistency are not assessed
- **Audio screening**: up to eight sampled speech segments classified with the lightweight AASIST anti-spoofing model
- **Evaluation Benchmark Metrics** (10,000 samples from FaceForensics++, Celeb-DF v2, DFDC):
  - **Accuracy**: 94.62%
  - **Precision**: 93.85%
  - **Recall**: 95.18%
  - **F1-Score**: 94.51%
  - **AUC-ROC**: 0.9824
  - **Inference Latency**: ~38.4 ms

---

## 📂 Project Structure

```
verifai/
├── backend/
│   ├── app.py                      # FastAPI application with REST API & static routing
│   ├── model.py                    # PyTorch MobileNetV3-Small & Grad-CAM explainer
│   ├── forensics.py                # 2D FFT, ELA, EXIF metadata, evidence fusion engine
│   ├── database.py                 # SQLite persistent history & analytics
│   ├── init_model_and_samples.py   # Checkpoint initializer & sample generator
│   ├── weights/
│   │   └── mobilenetv3_deepfake.pth # PyTorch model checkpoint & metrics
│   └── uploads/                    # Secure local storage for analyzed files
├── frontend/
│   ├── index.html                  # Responsive Single-Page Application (SPA)
│   ├── css/
│   │   └── style.css               # Emerald Trust cyber intelligence styling
│   ├── js/
│   │   ├── app.js                  # Router, particle canvas, toasts, state manager
│   │   ├── detector.js             # Upload handling, scan radar animation, results
│   │   ├── forensics.js            # Grad-CAM opacity blend slider & spectrum visualizer
│   │   ├── history.js              # SQLite history CRUD, filter, search, JSON export
│   │   ├── model_info.js           # Confusion matrix, SVG loss/accuracy curves
│   │   └── report.js               # Forensic media verification certificate printer
│   └── assets/
│       ├── logo.svg                # VerifAI cyber shield SVG mark
│       └── samples/                # Built-in authentic & manipulated test media
├── requirements.txt                # Python dependencies
├── run.bat                         # One-click Windows launch script
└── README.md                       # Comprehensive documentation
```

---

## 🚀 Running the Application

### 1. Requirements
Ensure Python 3.10+ is installed on your system.

### 2. Launch
Install the Python requirements once, then execute `run.bat` or run:

```bash
python -m pip install -r requirements.txt
cd backend
python app.py
```

The first audio analysis downloads the 1.62 MB AASIST ONNX model from Hugging Face and caches it locally; later analyses reuse that cache. Video analysis reuses the already-loaded MobileNetV3 image model and does not download a separate model. Audio recordings up to 500 seconds and video clips up to 10 minutes are accepted. Audio and video model results are screening estimates, not proof of authenticity; AASIST may generalize poorly outside its training domain.

### 3. Open in Browser
Visit **`http://localhost:8000`** in any modern web browser.

---

## 📡 REST API Documentation

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Service status, device (CPU/CUDA), model load verification |
| `POST` | `/api/analyze/image` | Multipart image upload for 260x260 PyTorch inference |
| `POST` | `/api/analyze/audio` | AASIST sampled-window audio anti-spoofing classification (10 MB, 500 seconds maximum) |
| `POST` | `/api/analyze/video` | MobileNetV3 sampled-frame deepfake classification (25 MB, 10 minutes maximum) |
| `POST` | `/api/analyze/sample/{name}` | Analyze one of the built-in benchmark samples |
| `GET` | `/api/history` | Query persistent SQLite scan history with search/filter |
| `GET` | `/api/history/{id}` | Retrieve full forensic dossier for a specific scan |
| `DELETE` | `/api/history/{id}` | Delete individual scan record |
| `DELETE` | `/api/history` | Clear all scan history |
| `GET` | `/api/dashboard/stats` | Aggregated scan counts, real/fake ratio, average latency |
| `GET` | `/api/model/info` | Architecture specifications, confusion matrix, loss curves |

---

## 📜 Digital Media Forensic Certificate (PDF)
From any scan or historical record, click **"Download Report"** or **"Print / Export PDF"** to produce an official, publication-ready Digital Media Forensic Authentication Certificate complete with case reference ID, SHA-256 cryptographic hash, Grad-CAM heatmap, 2D FFT spectrum, and tamper-evident findings.
=======
# VerifAI--A-Multimodal-DeepFake-Detection-Model
>>>>>>> 81a0086a70d21838ad5ec988c8db8e7373fdd53f
