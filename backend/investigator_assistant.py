"""Local evidence triage, retrieval and optional on-device LLM narration."""
import json
import os
import re
import urllib.request

KNOWLEDGE = [
    {"source": "NIST SP 800-86", "url": "https://csrc.nist.gov/pubs/sp/800/86/final", "modality": "general", "terms": "chain custody hash evidence forensic preservation original media", "text": "Preserve the original media, record a cryptographic hash at acquisition, document each handling step, and conduct analysis on a working copy. A matching hash supports integrity since hashing; it does not prove who created the file or that it was authentic at capture."},
    {"source": "C2PA Technical Specification", "url": "https://c2pa.org/specifications/specifications/2.2/specs/C2PA_Specification.html", "modality": "general", "terms": "c2pa provenance content credentials manifest signature", "text": "Content Credentials can carry signed provenance assertions. A valid manifest supports that the signed assertions have not changed since signing; absence of credentials is inconclusive and credentials do not establish that depicted events are true."},
    {"source": "FaceForensics++ benchmark", "url": "https://arxiv.org/abs/1901.08971", "modality": "video", "terms": "video face swap deepfake frame detector compression generalization", "text": "FaceForensics++ evaluates face manipulation methods on a defined benchmark. Frame-level classifiers can be sensitive to compression, face visibility, and generator shift. A score on sampled frames is a screening signal, not proof or a source attribution."},
    {"source": "ASVspoof 2019 challenge", "url": "https://www.asvspoof.org/index2019.html", "modality": "audio", "terms": "audio speech spoof tts voice conversion codec noise language", "text": "ASVspoof benchmarks cover particular spoofing and voice-conversion conditions. Performance may change with unseen synthesis systems, language, channel, background noise, and re-encoding. Preserve and compare the original audio where possible."},
    {"source": "NIST AI Risk Management Framework", "url": "https://www.nist.gov/itl/ai-risk-management-framework", "modality": "general", "terms": "uncertainty false positives human review limitations high stakes", "text": "Automated scores should be interpreted with documented uncertainty, known limitations, and independent human review. Do not use a detector result by itself to make a consequential accusation or investigative decision."},
]

def retrieve_knowledge(modality, evidence, limit=3):
    query = (modality + " " + json.dumps(evidence, ensure_ascii=False)).lower()
    tokens = set(re.findall(r"[a-z0-9]+", query))
    ranked = []
    for item in KNOWLEDGE:
        terms = set(item["terms"].split())
        score = len(tokens & terms) + (2 if item["modality"] in (modality, "general") else 0)
        ranked.append((score, item))
    return [{"source": item["source"], "url": item["url"], "text": item["text"]} for score, item in sorted(ranked, key=lambda row: row[0], reverse=True)[:limit]]

def build_investigator_report(modality, result):
    evidence = {"prediction": result.get("prediction"), "confidence": result.get("confidence"),
                "model": result.get("model"), "findings": result.get("findings", []),
                "frame_count": result.get("frame_count"), "segments": result.get("segments")}
    sources = retrieve_knowledge(modality, evidence)
    finding_lines = result.get("findings") or ["Model analysis completed; no additional anomaly descriptors were returned."]
    next_steps = ["Retain the source file and record its SHA-256 hash at acquisition.",
                  "Review the media and model findings independently before drawing conclusions.",
                  "Record the detector version, model identifier, and processing environment in case notes."]
    narrative = (f"The {modality} screening model ({result.get('model', 'configured model')}) returned "
                 f"{result.get('prediction', 'an indeterminate result')} with a model score of "
                 f"{result.get('confidence', 'not reported')}%. This is a probabilistic screening result, not proof of authenticity, manipulation, or source attribution. "
                 + " ".join(finding_lines))

    # Optional local Ollama model. Evidence and media remain on this machine.
    ollama_model = os.getenv("VERIFAI_OLLAMA_MODEL", "").strip()
    llm_used = False
    if ollama_model:
        try:
            payload = json.dumps({"model": ollama_model, "stream": False, "prompt":
                "Write a concise plain-language investigative note from the supplied evidence. "
                "Do not infer a person's intent, identity, or guilt. State uncertainty and cite only the supplied sources.\n"
                + json.dumps({"evidence": evidence, "retrieved_forensic_knowledge": sources})}).encode()
            req = urllib.request.Request("http://127.0.0.1:11434/api/generate", data=payload,
                                         headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as response:
                generated = json.loads(response.read().decode()).get("response", "").strip()
                if generated:
                    narrative = generated
                    llm_used = True
        except Exception:
            pass

    return {"summary": narrative, "findings": finding_lines, "recommended_checks": next_steps,
            "retrieved_sources": sources, "llm": "local Ollama" if llm_used else "evidence-grounded local template",
            "agent_steps": ["validated modality and file metadata", "collected model outputs", "retrieved relevant forensic guidance", "assembled a human-readable case note"],
            "caveat": "Automated results are screening signals. Preserve originals and obtain independent expert review."}
