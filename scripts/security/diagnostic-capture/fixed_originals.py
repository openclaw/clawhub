"""Sealed five-skill custody registry; no caller-selected identity or policy."""
import hashlib,json
from pathlib import Path
REGISTRY_SHA256="3c9e7043b24b5550d267d681477e42e1306b410a57ae8c3c654032b1edd4fabe"


def load_registry():
    value=json.loads((Path(__file__).parent/'fixed-originals.json').read_text())
    if hashlib.sha256(json.dumps(value,separators=(',',':')).encode()).hexdigest()!=REGISTRY_SHA256:
        raise ValueError('fixed original registry identity differs')
    return value


def skill_originals():
    return {entry['id']:entry for entry in load_registry()['originals']}


def validate_skill_case(config,case_id):
    registry=load_registry();entry=next((entry for entry in registry['originals']if entry['id']==case_id),None)
    if entry is None:raise ValueError('unknown fixed original')
    case=config['cases'][case_id]
    if (config.get('source')!=registry['source']or config.get('registrySha256')!=REGISTRY_SHA256
        or len(config['cases'])!=1 or case.get('identity')!=entry or case.get('files')!=entry['files']):
        raise ValueError('fixed original custody identity differs')
    return entry
