import sqlite3
import os
import json
from datetime import datetime
from typing import Dict, Any, List, Optional

DB_PATH = os.getenv("VERIFAI_DB_PATH", os.path.join(os.path.dirname(__file__), "verifai_history.db"))

def get_connection():
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS scans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        analysis_id TEXT UNIQUE NOT NULL,
        filename TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        dimensions TEXT NOT NULL,
        format TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        prediction TEXT NOT NULL,
        confidence REAL NOT NULL,
        real_score REAL NOT NULL,
        fake_score REAL NOT NULL,
        processing_time_ms REAL NOT NULL,
        gradcam_path TEXT,
        fft_path TEXT,
        ela_path TEXT,
        forensic_data TEXT,
        created_at TEXT NOT NULL
    )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_prediction ON scans(prediction)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_created_at ON scans(created_at)")
    conn.commit()
    conn.close()

def save_scan(data: Dict[str, Any]) -> Dict[str, Any]:
    conn = get_connection()
    cursor = conn.cursor()
    
    forensic_str = json.dumps(data.get("forensic_data", {}))
    now = datetime.utcnow().isoformat() + "Z"
    analysis_id = data.get("analysis_id") or f"VFY-{datetime.now().strftime('%Y%m%d%H%M%S')}-{os.urandom(2).hex()}"
    
    cursor.execute("""
    INSERT INTO scans (
        analysis_id, filename, file_path, file_size, dimensions,
        format, sha256, prediction, confidence, real_score,
        fake_score, processing_time_ms, gradcam_path, fft_path,
        ela_path, forensic_data, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        analysis_id,
        data.get("filename", "unknown.jpg"),
        data.get("file_path", ""),
        data.get("file_size", 0),
        data.get("dimensions", "0x0"),
        data.get("format", "JPEG"),
        data.get("sha256", ""),
        data.get("prediction", "REAL"),
        data.get("confidence", 0.0),
        data.get("real_score", 0.0),
        data.get("fake_score", 0.0),
        data.get("processing_time_ms", 0.0),
        data.get("gradcam_path", ""),
        data.get("fft_path", ""),
        data.get("ela_path", ""),
        forensic_str,
        now
    ))
    
    inserted_id = cursor.lastrowid
    conn.commit()
    
    cursor.execute("SELECT * FROM scans WHERE id = ?", (inserted_id,))
    row = cursor.fetchone()
    conn.close()
    
    res = dict(row)
    if res.get("forensic_data"):
        try:
            res["forensic_data"] = json.loads(res["forensic_data"])
        except Exception:
            pass
    return res

def get_scans(limit: int = 50, offset: int = 0, status: Optional[str] = None, search: Optional[str] = None) -> List[Dict[str, Any]]:
    conn = get_connection()
    cursor = conn.cursor()
    
    query = "SELECT * FROM scans WHERE 1=1"
    params = []
    
    if status and status.upper() in ["REAL", "FAKE"]:
        query += " AND prediction = ?"
        params.append(status.upper())
        
    if search:
        query += " AND (filename LIKE ? OR analysis_id LIKE ?)"
        params.extend([f"%{search}%", f"%{search}%"])
        
    query += " ORDER BY id DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])
    
    cursor.execute(query, params)
    rows = cursor.fetchall()
    conn.close()
    
    results = []
    for r in rows:
        item = dict(r)
        if item.get("forensic_data"):
            try:
                item["forensic_data"] = json.loads(item["forensic_data"])
            except Exception:
                pass
        results.append(item)
    return results

def get_scan_by_id(scan_id: Any) -> Optional[Dict[str, Any]]:
    conn = get_connection()
    cursor = conn.cursor()
    
    if str(scan_id).isdigit():
        cursor.execute("SELECT * FROM scans WHERE id = ?", (int(scan_id),))
    else:
        cursor.execute("SELECT * FROM scans WHERE analysis_id = ?", (str(scan_id),))
        
    row = cursor.fetchone()
    conn.close()
    
    if not row:
        return None
    item = dict(row)
    if item.get("forensic_data"):
        try:
            item["forensic_data"] = json.loads(item["forensic_data"])
        except Exception:
            pass
    return item

def delete_scan(scan_id: Any) -> bool:
    conn = get_connection()
    cursor = conn.cursor()
    if str(scan_id).isdigit():
        cursor.execute("DELETE FROM scans WHERE id = ?", (int(scan_id),))
    else:
        cursor.execute("DELETE FROM scans WHERE analysis_id = ?", (str(scan_id),))
    deleted = cursor.rowcount > 0
    conn.commit()
    conn.close()
    return deleted

def clear_all_scans() -> int:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM scans")
    count = cursor.rowcount
    conn.commit()
    conn.close()
    return count

def get_stats() -> Dict[str, Any]:
    conn = get_connection()
    cursor = conn.cursor()
    
    cursor.execute("SELECT COUNT(*) FROM scans")
    total_scans = cursor.fetchone()[0]
    
    cursor.execute("SELECT COUNT(*) FROM scans WHERE prediction = 'REAL'")
    real_count = cursor.fetchone()[0]
    
    cursor.execute("SELECT COUNT(*) FROM scans WHERE prediction = 'FAKE'")
    fake_count = cursor.fetchone()[0]
    
    cursor.execute("SELECT AVG(confidence), AVG(processing_time_ms) FROM scans")
    avg_row = cursor.fetchone()
    avg_conf = round(avg_row[0] or 0.0, 2)
    avg_time = round(avg_row[1] or 0.0, 1)
    
    cursor.execute("SELECT * FROM scans ORDER BY id DESC LIMIT 5")
    recent_rows = cursor.fetchall()
    conn.close()
    
    recent_scans = []
    for r in recent_rows:
        item = dict(r)
        if item.get("forensic_data"):
            try:
                item["forensic_data"] = json.loads(item["forensic_data"])
            except Exception:
                pass
        recent_scans.append(item)
        
    return {
        "total_scans": total_scans,
        "real_count": real_count,
        "fake_count": fake_count,
        "avg_confidence": avg_conf,
        "avg_processing_time_ms": avg_time,
        "recent_scans": recent_scans
    }

init_db()
