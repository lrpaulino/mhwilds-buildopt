# -*- coding: utf-8 -*-

import cvxpy as cp
import numpy as np
from typing import List, Tuple, Dict, Optional, Union

class BuildOptimizer:
    def __init__(self, skills, armor, weapons, charms, decorations):
        # Apenas armaduras de alto rank
        self.armor = [a for a in armor if a.get('rank') == 'high']
        
        if isinstance(weapons, list):
            self.weapons = {w['id']: w for w in weapons}
        else:
            self.weapons = weapons
            
        if isinstance(charms, list):
            self.charms = {c['id']: c for c in charms}
        else:
            self.charms = charms
            
        self.decorations = decorations
        self.skills = skills

        # Mapeamentos auxiliares de habilidades
        self.skill_max = {}
        self.skill_name = {}
        self.skill_icon_kind = {}
        for s in skills:
            max_lv = max(r['level'] for r in s['ranks']) if s.get('ranks') else 1
            self.skill_max[s['id']] = max_lv
            self.skill_name[s['id']] = s['name']
            self.skill_icon_kind[s['id']] = s.get('icon', {}).get('kind', 'utility')

        # Organizar armaduras por peça (kind: head, chest, arms, waist, legs)
        self.armor_by_slot = {'head': [], 'chest': [], 'arms': [], 'waist': [], 'legs': []}
        for a in self.armor:
            kind = a.get('kind')
            if kind in self.armor_by_slot:
                self.armor_by_slot[kind].append(a)

        # Pré-computar dados
        self._precompute()

    def _precompute(self):
        # Armaduras
        self.armor_skills = {}
        self.armor_slots = {}
        for a in self.armor:
            sid = a['id']
            self.armor_skills[sid] = {s['skill']['id']: s['level'] for s in a.get('skills', []) if 'skill' in s}
            self.armor_slots[sid] = a.get('slots', [])

        # Armas
        self.weapon_skills = {}
        self.weapon_slots = {}
        for w in self.weapons.values():
            wid = w['id']
            self.weapon_skills[wid] = {s['skill']['id']: s['level'] for s in w.get('skills', []) if 'skill' in s}
            self.weapon_slots[wid] = w.get('slots', [])

        # Amuletos
        self.charm_skills = {}
        self.charm_slots = {}
        self.charm_display_name = {}
        for c in self.charms.values():
            cid = c['id']
            best_rank = max(c['ranks'], key=lambda r: r['level']) if c.get('ranks') else None
            if best_rank:
                self.charm_skills[cid] = {s['skill']['id']: s['level'] for s in best_rank.get('skills', []) if 'skill' in s}
                self.charm_slots[cid] = best_rank.get('slots', [])
                self.charm_display_name[cid] = best_rank.get('name', f'Charm {cid}')
            else:
                self.charm_skills[cid] = {}
                self.charm_slots[cid] = []
                self.charm_display_name[cid] = f'Charm {cid}'

        # Separar decorações em arma vs armadura
        self.weapon_decos = [d for d in self.decorations if d.get('kind') == 'weapon']
        self.armor_decos = [d for d in self.decorations if d.get('kind') == 'armor']

        self.deco_skills = {}
        self.deco_slot = {}
        for d in self.decorations:
            did = d['id']
            self.deco_skills[did] = {s['skill']['id']: s['level'] for s in d.get('skills', []) if 'skill' in s}
            self.deco_slot[did] = d.get('slot', 1)

    def optimize(self, target_skills: List[int], weapon_id: int, charm_id: Optional[int] = None, min_levels: Optional[Dict[int, int]] = None):
        if weapon_id not in self.weapons:
            raise ValueError(f'Arma com ID {weapon_id} não foi encontrada.')

        chosen_weapon = self.weapons[weapon_id]
        
        n_armor = len(self.armor)
        charm_ids = list(self.charms.keys())
        n_charms = len(charm_ids)
        
        n_wdecos = len(self.weapon_decos)
        n_adecos = len(self.armor_decos)

        # Variáveis de decisão
        x_armor = cp.Variable(n_armor, boolean=True)
        x_charm = cp.Variable(n_charms, boolean=True)
        x_wdeco = cp.Variable(n_wdecos, integer=True)
        x_adeco = cp.Variable(n_adecos, integer=True)

        constraints = []

        # 0. Decorações não podem ter quantidade negativa
        if n_wdecos > 0:
            constraints.append(x_wdeco >= 0)
        if n_adecos > 0:
            constraints.append(x_adeco >= 0)

        # 1. Escolher exatamente 1 peça por tipo de armadura (head, chest, arms, waist, legs)
        armor_idx = {a['id']: i for i, a in enumerate(self.armor)}
        for slot_kind, pieces in self.armor_by_slot.items():
            indices = [armor_idx[p['id']] for p in pieces]
            if indices:
                constraints.append(cp.sum(x_armor[indices]) == 1)

        # 2. Amuleto
        charm_idx = {cid: i for i, cid in enumerate(charm_ids)}
        if charm_id is not None:
            if charm_id not in charm_idx:
                raise ValueError('Amuleto selecionado inválido ou não encontrado.')
            constraints.append(x_charm[charm_idx[charm_id]] == 1)
            for cid in charm_ids:
                if cid != charm_id:
                    constraints.append(x_charm[charm_idx[cid]] == 0)
        else:
            constraints.append(cp.sum(x_charm) <= 1)

        # 3. Restrições de Encaixes (Weapon Decos -> Weapon Slots; Armor Decos -> Armor Slots)
        w_slots = chosen_weapon.get('slots', [])
        
        # Encaixes da arma
        for L in [1, 2, 3]:
            wdeco_indices = [k for k, d in enumerate(self.weapon_decos) if d.get('slot', 1) >= L]
            w_capacity = sum(1 for s in w_slots if s >= L)
            if wdeco_indices:
                constraints.append(cp.sum(x_wdeco[wdeco_indices]) <= w_capacity)

        # Encaixes das armaduras
        for L in [1, 2, 3]:
            adeco_indices = [k for k, d in enumerate(self.armor_decos) if d.get('slot', 1) >= L]
            if adeco_indices:
                armor_cap_expr = 0
                for a in self.armor:
                    i = armor_idx[a['id']]
                    cnt = sum(1 for s in a.get('slots', []) if s >= L)
                    if cnt > 0:
                        armor_cap_expr += cnt * x_armor[i]
                constraints.append(cp.sum(x_adeco[adeco_indices]) <= armor_cap_expr)

        # 4. Níveis efetivos de habilidade, teto máximo, restrições mínimas (min_levels) e penalidade de sobra (overflow)
        all_skill_ids = set(self.skill_max.keys())
        for ts in target_skills:
            all_skill_ids.add(ts)

        eff_skill = {}
        raw_skill_expr = {}
        overflow_var = {}

        for sid in all_skill_ids:
            expr = 0
            # Arma (nativa)
            expr += self.weapon_skills.get(weapon_id, {}).get(sid, 0)

            # Armaduras (nativas)
            for a in self.armor:
                i = armor_idx[a['id']]
                lv = self.armor_skills[a['id']].get(sid, 0)
                if lv > 0:
                    expr += lv * x_armor[i]

            # Amuleto (nativo)
            for cid in charm_ids:
                j = charm_idx[cid]
                lv_c = self.charm_skills[cid].get(sid, 0)
                if lv_c > 0:
                    expr += lv_c * x_charm[j]

            # Decorações de Arma
            for k, d in enumerate(self.weapon_decos):
                lv_d = self.deco_skills[d['id']].get(sid, 0)
                if lv_d > 0:
                    expr += lv_d * x_wdeco[k]

            # Decorações de Armadura
            for m, d in enumerate(self.armor_decos):
                lv_d = self.deco_skills[d['id']].get(sid, 0)
                if lv_d > 0:
                    expr += lv_d * x_adeco[m]

            raw_skill_expr[sid] = expr

            max_lv = self.skill_max.get(sid, 7)
            var = cp.Variable(nonneg=True)
            constraints.append(var <= max_lv)
            constraints.append(var <= expr)
            
            # Adicionar restrição de nível mínimo exigido pelo usuário (se configurada)
            if min_levels and sid in min_levels and min_levels[sid] is not None:
                req_min = min(min_levels[sid], max_lv)
                if req_min > 0:
                    constraints.append(var >= req_min)

            eff_skill[sid] = var

            # Variável de pontuação excedente (sobra desperdiçada)
            of_var = cp.Variable(nonneg=True)
            constraints.append(of_var >= expr - max_lv)
            overflow_var[sid] = of_var

        # 5. Função Objetivo
        n_targets = len(target_skills)
        BASE_WEIGHT = 8.0
        
        target_obj = 0
        for rank_idx, sid in enumerate(target_skills):
            weight = BASE_WEIGHT ** (n_targets - 1 - rank_idx)
            target_obj += weight * eff_skill[sid]

        # Bônus secundário: preferir habilidades nativas em armaduras para economizar slots
        native_bonus = 0
        for ts in target_skills:
            for a in self.armor:
                i = armor_idx[a['id']]
                lv = self.armor_skills[a['id']].get(ts, 0)
                if lv > 0:
                    native_bonus += 0.01 * lv * x_armor[i]

        # Bônus terciário: slots livres de armadura remanescentes
        slots_sum_expr = 0
        for a in self.armor:
            i = armor_idx[a['id']]
            sum_s = sum(a.get('slots', []))
            if sum_s > 0:
                slots_sum_expr += sum_s * x_armor[i]
        
        used_adecos_sum = 0
        for m, d in enumerate(self.armor_decos):
            used_adecos_sum += d.get('slot', 1) * x_adeco[m]

        free_slots_bonus = 0.001 * (slots_sum_expr - used_adecos_sum)

        # Penalidade por sobras desperdiçadas acima do teto máximo de habilidades
        overflow_penalty = 0.005 * sum(overflow_var.values())

        objective = cp.Maximize(target_obj + native_bonus + free_slots_bonus - overflow_penalty)

        problem = cp.Problem(objective, constraints)
        
        # Resolver usando GLPK_MI ou HIGHS
        try:
            problem.solve(solver=cp.GLPK_MI, verbose=False)
        except Exception:
            problem.solve(solver=cp.HIGHS, verbose=False)

        if problem.status not in ['optimal', 'optimal_inaccurate']:
            raise RuntimeError(f'Não foi possível encontrar uma combinação que atinja as restrições mínimas exigidas ({problem.status}). Tente diminuir os níveis mínimos exigidos.')

        # Processar Armaduras Escolhidas
        selected_armors = []
        for a in self.armor:
            i = armor_idx[a['id']]
            if x_armor[i].value is not None and x_armor[i].value > 0.5:
                selected_armors.append(a)

        # Ordenar armaduras na sequência padrão: head, chest, arms, waist, legs
        kind_order = {'head': 0, 'chest': 1, 'arms': 2, 'waist': 3, 'legs': 4}
        selected_armors.sort(key=lambda a: kind_order.get(a.get('kind'), 99))

        # Processar Amuleto Escolhido
        selected_charm = None
        for cid in charm_ids:
            j = charm_idx[cid]
            if x_charm[j].value is not None and x_charm[j].value > 0.5:
                selected_charm = self.charms[cid]
                break

        # Processar Gemas Escolhidas
        selected_wdecos = []
        for k, d in enumerate(self.weapon_decos):
            cnt = int(round(x_wdeco[k].value)) if x_wdeco[k].value is not None else 0
            for _ in range(cnt):
                selected_wdecos.append(d)

        selected_adecos = []
        for m, d in enumerate(self.armor_decos):
            cnt = int(round(x_adeco[m].value)) if x_adeco[m].value is not None else 0
            for _ in range(cnt):
                selected_adecos.append(d)

        # Mapeamento Exato de Gemas nos Encaixes (Slots)
        assigned_weapon_slots = self._assign_decos_to_slots(chosen_weapon.get('slots', []), selected_wdecos)
        
        armor_pieces_assigned = []
        for a in selected_armors:
            slots_list = a.get('slots', [])
            armor_pieces_assigned.append({
                'piece': a,
                'slots_list': slots_list
            })

        assigned_armor_slots = self._assign_decos_across_pieces(armor_pieces_assigned, selected_adecos)

        # Nomes traduzidos de peças
        kind_tr_map = {
            'head': 'Cabeça',
            'chest': 'Peito',
            'arms': 'Braços',
            'waist': 'Cintura',
            'legs': 'Pernas'
        }

        # Níveis finais de habilidades ativadas + Origem de cada ponto + Sobras
        final_skills_summary = {}
        
        skills_to_include = set(target_skills)
        for sid in all_skill_ids:
            eff_val = int(round(eff_skill[sid].value)) if eff_skill[sid].value is not None else 0
            if eff_val > 0:
                skills_to_include.add(sid)

        for sid in skills_to_include:
            eff_val = int(round(eff_skill[sid].value)) if eff_skill[sid].value is not None else 0
            raw_val = int(round(raw_skill_expr[sid].value)) if isinstance(raw_skill_expr[sid], cp.Expression) else raw_skill_expr[sid]
            max_lv = self.skill_max.get(sid, 7)
            is_tgt = sid in target_skills
            priority = target_skills.index(sid) + 1 if is_tgt else None
            raw_min_req = min_levels.get(sid) if min_levels else None
            min_req = min(raw_min_req, max_lv) if raw_min_req is not None else None
            
            overflow = max(0, raw_val - max_lv)

            sources = []

            # Nativa na Arma
            lv_w = self.weapon_skills.get(weapon_id, {}).get(sid, 0)
            if lv_w > 0:
                sources.append({'source': f"Arma: {chosen_weapon['name']}", 'level': lv_w, 'type': 'weapon_native'})

            # Nativa nas Armaduras
            for a in selected_armors:
                lv_a = self.armor_skills[a['id']].get(sid, 0)
                if lv_a > 0:
                    ktr = kind_tr_map.get(a.get('kind'), a.get('kind'))
                    sources.append({'source': f"{ktr}: {a['name']}", 'level': lv_a, 'type': 'armor_native'})

            # Nativa no Amuleto
            if selected_charm:
                lv_c = self.charm_skills.get(selected_charm['id'], {}).get(sid, 0)
                if lv_c > 0:
                    cname = self.charm_display_name.get(selected_charm['id'], selected_charm.get('name'))
                    sources.append({'source': f"Amuleto: {cname}", 'level': lv_c, 'type': 'charm_native'})

            # Gemas na Arma
            for slot_entry in assigned_weapon_slots:
                d = slot_entry.get('decoration')
                if d:
                    lv_d = self.deco_skills.get(d['id'], {}).get(sid, 0)
                    if lv_d > 0:
                        sources.append({'source': f"Gema na Arma: {d['name']}", 'level': lv_d, 'type': 'decoration'})

            # Gemas nas Armaduras
            for a in selected_armors:
                ktr = kind_tr_map.get(a.get('kind'), a.get('kind'))
                for slot_entry in assigned_armor_slots[a['id']]:
                    d = slot_entry.get('decoration')
                    if d:
                        lv_d = self.deco_skills.get(d['id'], {}).get(sid, 0)
                        if lv_d > 0:
                            sources.append({'source': f"Gema em {ktr} ({a['name']}): {d['name']}", 'level': lv_d, 'type': 'decoration'})

            status_type = 'target_acquired' if is_tgt and eff_val > 0 else ('target_unacquired' if is_tgt else 'extra_acquired')

            final_skills_summary[self.skill_name[sid]] = {
                'id': sid,
                'level': eff_val,
                'raw_level': raw_val,
                'max_level': max_lv,
                'overflow': overflow,
                'min_required': min_req,
                'icon_kind': self.skill_icon_kind.get(sid, 'utility'),
                'is_target': is_tgt,
                'priority': priority,
                'status_type': status_type,
                'sources': sources
            }

        # Ordenar lista de habilidades
        status_order = {'target_acquired': 0, 'target_unacquired': 1, 'extra_acquired': 2}
        sorted_skills = dict(sorted(
            final_skills_summary.items(),
            key=lambda item: (
                status_order.get(item[1]['status_type'], 9),
                item[1]['priority'] or 999,
                -item[1]['level'],
                item[0]
            )
        ))

        # Montar resposta estruturada
        return {
            'weapon': {
                'id': chosen_weapon['id'],
                'name': chosen_weapon['name'],
                'kind': chosen_weapon.get('kind', ''),
                'slots': assigned_weapon_slots,
                'skills': [
                    {'name': self.skill_name.get(s['skill']['id']), 'level': s['level']}
                    for s in chosen_weapon.get('skills', []) if 'skill' in s
                ]
            },
            'armor': [
                {
                    'id': a['id'],
                    'name': a['name'],
                    'kind': a.get('kind', ''),
                    'slots': assigned_armor_slots[a['id']],
                    'skills': [
                        {'name': self.skill_name.get(s['skill']['id']), 'level': s['level']}
                        for s in a.get('skills', []) if 'skill' in s
                    ]
                }
                for a in selected_armors
            ],
            'charm': {
                'id': selected_charm['id'],
                'name': self.charm_display_name.get(selected_charm['id'], selected_charm.get('name', '')),
                'skills': [
                    {'name': self.skill_name.get(sid), 'level': lv}
                    for sid, lv in self.charm_skills.get(selected_charm['id'], {}).items()
                ]
            } if selected_charm else None,
            'skills': sorted_skills,
            'status': problem.status
        }

    def _assign_decos_to_slots(self, slots: List[int], decos: List[Dict]):
        sorted_slots = sorted(slots, reverse=True)
        slot_entries = [{'slot_size': s, 'decoration': None} for s in sorted_slots]
        
        decos_sorted = sorted(decos, key=lambda d: d.get('slot', 1), reverse=True)

        for d in decos_sorted:
            d_size = d.get('slot', 1)
            best_idx = None
            best_size = 999
            for idx, entry in enumerate(slot_entries):
                if entry['decoration'] is None and entry['slot_size'] >= d_size:
                    if entry['slot_size'] < best_size:
                        best_size = entry['slot_size']
                        best_idx = idx
            if best_idx is not None:
                slot_entries[best_idx]['decoration'] = {
                    'id': d['id'],
                    'name': d['name'],
                    'slot': d.get('slot', 1)
                }

        return slot_entries

    def _assign_decos_across_pieces(self, armor_pieces: List[Dict], decos: List[Dict]):
        result_by_armor_id = {}
        all_entries = []

        for item in armor_pieces:
            aid = item['piece']['id']
            slots = sorted(item['slots_list'], reverse=True)
            result_by_armor_id[aid] = [{'slot_size': s, 'decoration': None} for s in slots]
            for idx, s in enumerate(slots):
                all_entries.append((aid, idx, s))

        decos_sorted = sorted(decos, key=lambda d: d.get('slot', 1), reverse=True)

        for d in decos_sorted:
            d_size = d.get('slot', 1)
            best_match = None
            for aid, idx, s_size in all_entries:
                if result_by_armor_id[aid][idx]['decoration'] is None and s_size >= d_size:
                    if best_match is None or s_size < best_match[2]:
                        best_match = (aid, idx, s_size)
            if best_match is not None:
                aid, idx, _ = best_match
                result_by_armor_id[aid][idx]['decoration'] = {
                    'id': d['id'],
                    'name': d['name'],
                    'slot': d.get('slot', 1)
                }

        return result_by_armor_id
