# -*- coding: utf-8 -*-

import os
from typing import List, Optional, Union, Dict, Any

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .data_loader import get_all_data
from .optimizer import BuildOptimizer


app = FastAPI(title='MH Wilds Build Optimizer')

# Carregar dados na inicialização
skills, armor, weapons, charms, decorations = get_all_data()
optimizer = BuildOptimizer(skills, armor, weapons, charms, decorations)

# Servir frontend
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), '..', 'frontend')
app.mount('/static', StaticFiles(directory=FRONTEND_DIR), name='static')

class TargetSkillItem(BaseModel):
    id: int
    min_level: Optional[int] = None

class OptimizeRequest(BaseModel):
    target_skills: List[Union[int, TargetSkillItem, Dict[str, Any]]] # Aceita IDs diretos ou objetos com restrições
    weapon_id: int
    charm_id: Optional[int] = None

@app.post('/optimize')
def optimize_build(req: OptimizeRequest):
    try:
        if not req.target_skills:
            raise ValueError('Selecione pelo menos uma habilidade desejada.')
        
        target_ids = []
        min_levels = {}

        for item in req.target_skills:
            if isinstance(item, int):
                target_ids.append(item)
            elif isinstance(item, dict):
                sid = item.get('id')
                if sid:
                    target_ids.append(sid)
                    if item.get('min_level') is not None:
                        min_levels[sid] = item.get('min_level')
            elif hasattr(item, 'id'):
                sid = item.id
                target_ids.append(sid)
                if item.min_level is not None:
                    min_levels[sid] = item.min_level

        result = optimizer.optimize(target_ids, req.weapon_id, req.charm_id, min_levels=min_levels)
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get('/')
def index():
    return FileResponse(os.path.join(FRONTEND_DIR, 'index.html'))

@app.get('/api/skills')
def list_skills():
    skills_data = []
    for s in skills:
        max_lv = max(r['level'] for r in s['ranks']) if s.get('ranks') else 1
        skills_data.append({
            'id': s['id'],
            'name': s['name'],
            'description': s.get('description', '') or '',
            'icon_kind': s.get('icon', {}).get('kind', 'utility'),
            'max_level': max_lv
        })
    skills_data.sort(key=lambda x: x['name'])
    return skills_data

@app.get('/api/weapons')
def list_weapons():
    sorted_weapons = sorted(
        [{'id': w['id'], 'name': w['name'], 'kind': w.get('kind', ''), 'slots': w.get('slots', [])} for w in weapons],
        key=lambda x: (x['kind'], x['name'])
    )
    return sorted_weapons

@app.get('/api/charms')
def list_charms():
    charms_list = []
    for c in charms:
        best_rank = max(c['ranks'], key=lambda r: r['level']) if c.get('ranks') else None
        name = best_rank['name'] if best_rank else f"Charm {c['id']}"
        charms_list.append({'id': c['id'], 'name': name})
    charms_list.sort(key=lambda x: x['name'])
    return charms_list
