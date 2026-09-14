# -*- coding: utf-8 -*-

import httpx
import json
from pathlib import Path

BASE_URL = 'https://wilds.mhdb.io/pt-BR'
DATA_DIR = Path(__file__).resolve().parent.parent / 'data'
DATA_DIR.mkdir(exist_ok=True)

def fetch(endpoint: str):
    url = f'{BASE_URL}/{endpoint}'
    print(f'Fetching {url}...')
    resp = httpx.get(url, timeout=60)
    resp.raise_for_status()
    return resp.json()

def save_json(name: str, data):
    path = DATA_DIR / f'{name}.json'
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f'Saved {path}')

def load_or_fetch(name: str, endpoint: str):
    path = DATA_DIR / f'{name}.json'
    if path.exists():
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    data = fetch(endpoint)
    save_json(name, data)
    return data

def get_all_data():
    skills = load_or_fetch('skills', 'skills')
    armor = load_or_fetch('armor', 'armor')
    weapons = load_or_fetch('weapons', 'weapons')
    charms = load_or_fetch('charms', 'charms')
    decorations = load_or_fetch('decorations', 'decorations')
    return skills, armor, weapons, charms, decorations