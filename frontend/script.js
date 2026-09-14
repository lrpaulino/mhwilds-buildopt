let allSkills = [];
let allWeapons = [];
let allCharms = [];
// selectedSkills = array de objetos { id: number, min_level: number | null }
let selectedSkills = [];

// Estado do combobox customizado
let currentSkillPoolId = null;   // id da skill atualmente selecionada no combobox
let filteredSkillsCache = [];    // skills visíveis no momento (para navegação por teclado)
let highlightedIndex = -1;       // índice destacado via teclado

let fuse = null;

const CATEGORY_MAP = [
    { kind: "attack", label: "Ataque" },
    { kind: "affinity", label: "Afinidade" },
    { kind: "element", label: "Elemento" },
    { kind: "handicraft", label: "Afiação" },
    { kind: "ranged", label: "Distância" },
    { kind: "defense", label: "Defesa" },
    { kind: "health", label: "Saúde" },
    { kind: "stamina", label: "Vigor" },
    { kind: "offense", label: "Ofensivo" },
    { kind: "utility", label: "Utilidade" },
    { kind: "item", label: "Itens" },
    { kind: "gathering", label: "Coleta" },
    { kind: "group", label: "Grupo" },
    { kind: "set", label: "Conjunto" }
];

let activeCategories = new Set(CATEGORY_MAP.map(c => c.kind));

const SKILL_PRESETS = {
    damage: ["Reforço de Ataque", "Exploração de Fraqueza", "Reforço Crítico", "Desafio"],
    crit: ["Olho Crítico", "Exploração de Fraqueza", "Reforço Crítico", "Afinidade de Elemento"],
    defense: ["Reforço de Defesa", "Bênção Divina", "Resistência a Elemento"],
    stamina: ["Extensão de Evasão", "Janela de Evasão", "Constituição", "Restauração de Vigor"],
    element: ["Elemento Crítico", "Ataque de Dragão", "Ataque de Fogo", "Ataque de Água", "Ataque de Raio", "Ataque de Gelo"],
    comfort: ["Sem Recuo", "Refeição Grátis", "Balística", "Artesanato"]
};

async function loadData() {
    try {
        const [skillsRes, weaponsRes, charmsRes] = await Promise.all([
            fetch("/api/skills").then(r => r.json()),
            fetch("/api/weapons").then(r => r.json()),
            fetch("/api/charms").then(r => r.json())
        ]);

        allSkills = skillsRes.map(s => ({
            ...s,
            _searchName: normalizeText(s.name),
            _searchDescription: normalizeText(s.description)
        }));

        fuse = new Fuse(allSkills, {
            keys: [
                { name: "_searchName", weight: 2 },  // nome vale mais
                { name: "_searchDescription", weight: 1 }
            ],
            threshold: 0.35,          // 0 = exato / 1 = tudo.
            ignoreLocation: true,     // não exige que o match esteja no começo
            minMatchCharLength: 2,    // evita match com 1 letra
            includeScore: true,
            shouldSort: true,
            findAllMatches: false
        });
        allWeapons = weaponsRes;
        allCharms = charmsRes;

        renderCategoryFilters();
        setupToggleAllFilters();
        populateSelects();
        setupSearchEvents();
    } catch (err) {
        console.error("Erro ao carregar dados da API:", err);
        alert("Erro ao carregar os dados iniciais do servidor.");
    }
}

// Remove acentos e coloca em minúsculo
function normalizeText(str) {
    return (str || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
}

function renderCategoryFilters() {
    const grid = document.getElementById("category-icons-grid");
    if (!grid) return;
    grid.innerHTML = "";

    CATEGORY_MAP.forEach(cat => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `cat-filter-btn ${activeCategories.has(cat.kind) ? 'active' : ''}`;
        btn.title = cat.label;
        btn.innerHTML = `
            <img src="/static/assets/skill_icons/${cat.kind}.avif" alt="${cat.label}" />
            <span>${cat.label}</span>
        `;
        btn.addEventListener("click", () => {
            if (activeCategories.has(cat.kind)) {
                activeCategories.delete(cat.kind);
            } else {
                activeCategories.add(cat.kind);
            }
            btn.classList.toggle("active", activeCategories.has(cat.kind));
            filterSkillPool();
        });
        grid.appendChild(btn);
    });
}

function setupToggleAllFilters() {
    const btn = document.getElementById("toggle-all-filters");
    if (!btn) return;

    btn.addEventListener("click", () => {
        if (activeCategories.size === CATEGORY_MAP.length) {
            activeCategories.clear();
        } else {
            activeCategories = new Set(CATEGORY_MAP.map(c => c.kind));
        }
        renderCategoryFilters();
        filterSkillPool();
    });
}

function setupSearchEvents() {
    const searchInput = document.getElementById("skill-search-input");
    if (searchInput) {
        searchInput.addEventListener("input", () => {
            filterSkillPool();

            const box = document.getElementById("skill-combobox");
            if (!box) return;

            const term = searchInput.value.trim();
            if (term.length === 0) return;

            // Abre o painel automaticamente
            if (!box.classList.contains("open")) openCombobox();

            // Destaca a primeira sugestão (permite Enter direto)
            highlightedIndex = filteredSkillsCache.length > 0 ? 0 : -1;
            updateComboboxHighlight();
        });

        // Reabre ao focar, se já houver texto
        searchInput.addEventListener("focus", () => {
            if (searchInput.value.trim().length > 0) {
                const box = document.getElementById("skill-combobox");
                if (box && !box.classList.contains("open")) openCombobox();
            }
        });

        // Navegação por teclado a partir do próprio input
        searchInput.addEventListener("keydown", handleComboboxKey);
    }

    const trigger = document.getElementById("skill-combobox-trigger");
    if (trigger) {
        trigger.addEventListener("click", (e) => {
            e.stopPropagation();
            toggleCombobox();
        });
        trigger.addEventListener("keydown", handleComboboxKey);
    }

    const optionsBox = document.getElementById("skill-combobox-options");
    if (optionsBox) optionsBox.addEventListener("scroll", hideSkillTooltip);

    // Fecha ao clicar fora — MAS não fecha se o clique for no input de busca
    document.addEventListener("click", (e) => {
        const box = document.getElementById("skill-combobox");
        const input = document.getElementById("skill-search-input");
        if (box && !box.contains(e.target) && e.target !== input) {
            closeCombobox();
        }
    });

    window.addEventListener("scroll", hideSkillTooltip, true);
    window.addEventListener("resize", hideSkillTooltip);
}

function filterSkillPool() {
    const searchInput = document.getElementById("skill-search-input");
    const term = searchInput ? searchInput.value.trim() : "";
    const optionsBox = document.getElementById("skill-combobox-options");
    if (!optionsBox) return;

    let candidates;
    if (!term) {
        candidates = allSkills;
    } else {
        candidates = fuse.search(normalizeText(term)).map(r => r.item);
    }

    const filtered = candidates.filter(s => activeCategories.has(s.icon_kind));

    if (filtered.length === 0 && term) {
        const loose = new Fuse(allSkills, {
            keys: ["_searchName"],
            threshold: 0.6,           // bem permissivo
            ignoreLocation: true,
            minMatchCharLength: 1
        });
        const suggestion = loose.search(normalizeText(term))[0];
        if (suggestion) {
            optionsBox.innerHTML = `
            <div class="combobox-empty">
                Nada encontrado.<br>
                Você quis dizer <strong>${suggestion.item.name}</strong>?
            </div>`;
            return;
        }
    }

    filteredSkillsCache = filtered;
    optionsBox.innerHTML = "";

    if (filtered.length === 0) {
        optionsBox.innerHTML = `<div class="combobox-empty">Nenhuma habilidade encontrada com os filtros.</div>`;
    } else {
        filtered.forEach(s => {
            const row = document.createElement("div");
            row.className = "combobox-option" + (s.id === currentSkillPoolId ? " selected" : "");
            row.dataset.id = s.id;
            row.setAttribute("role", "option");
            row.innerHTML = `
                <img src="/static/assets/skill_icons/${s.icon_kind}.avif" class="skill-icon-sm" alt="">
                <span class="combobox-option-name">${s.name}</span>
                <span class="combobox-option-lv">Máx ${s.max_level}</span>
            `;
            row.addEventListener("mouseenter", () => showSkillTooltip(row, s));
            row.addEventListener("mouseleave", hideSkillTooltip);
            row.addEventListener("click", () => selectSkillFromCombobox(s.id));
            optionsBox.appendChild(row);
        });
    }

    if (currentSkillPoolId && !filtered.some(s => s.id === currentSkillPoolId)) {
        currentSkillPoolId = null;
    }

    if (!term) {
        highlightedIndex = -1;
    }

    updateComboboxLabel();
    updateSkillPoolPreview();
}

function updateSkillPoolPreview() {
    const preview = document.getElementById("skill-pool-desc-preview");
    if (!preview) return;

    const skill = allSkills.find(s => s.id === currentSkillPoolId);

    if (skill) {
        preview.innerHTML = `
            <div class="preview-item">
                <img src="/static/assets/skill_icons/${skill.icon_kind}.avif" class="skill-icon-sm" alt="icon">
                <div>
                    <strong>${skill.name}</strong> (Nível Máximo: ${skill.max_level})
                    <div class="preview-desc">${skill.description}</div>
                </div>
            </div>
        `;
        preview.style.display = "block";
    } else {
        preview.innerHTML = "";
        preview.style.display = "none";
    }
}

/* ===================== Combobox customizado ===================== */

function openCombobox() {
    const box = document.getElementById("skill-combobox");
    const trigger = document.getElementById("skill-combobox-trigger");
    if (!box) return;
    box.classList.add("open");
    if (trigger) trigger.setAttribute("aria-expanded", "true");
    highlightedIndex = filteredSkillsCache.findIndex(s => s.id === currentSkillPoolId);
    updateComboboxHighlight();
}

function closeCombobox() {
    const box = document.getElementById("skill-combobox");
    const trigger = document.getElementById("skill-combobox-trigger");
    if (box) box.classList.remove("open");
    if (trigger) trigger.setAttribute("aria-expanded", "false");
    highlightedIndex = -1;
    updateComboboxHighlight();
    hideSkillTooltip();
}

function toggleCombobox() {
    const box = document.getElementById("skill-combobox");
    if (!box) return;
    box.classList.contains("open") ? closeCombobox() : openCombobox();
}

function updateComboboxHighlight() {
    const rows = document.querySelectorAll("#skill-combobox-options .combobox-option");
    rows.forEach((r, i) => {
        const on = i === highlightedIndex;
        r.classList.toggle("highlighted", on);
        if (on) r.scrollIntoView({ block: "nearest" });
    });
}

function handleComboboxKey(e) {
    const box = document.getElementById("skill-combobox");
    if (!box) return;
    const isOpen = box.classList.contains("open");

    if (!isOpen) {
        if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openCombobox();
        }
        return;
    }

    if (e.key === "ArrowDown") {
        e.preventDefault();
        highlightedIndex = Math.min(highlightedIndex + 1, filteredSkillsCache.length - 1);
        updateComboboxHighlight();
    } else if (e.key === "ArrowUp") {
        e.preventDefault();
        highlightedIndex = Math.max(highlightedIndex - 1, 0);
        updateComboboxHighlight();
    } else if (e.key === "Enter") {
        e.preventDefault();
        const skill = filteredSkillsCache[highlightedIndex];
        if (skill) selectSkillFromCombobox(skill.id);
    } else if (e.key === "Escape") {
        e.preventDefault();
        closeCombobox();
    }
}

function selectSkillFromCombobox(id) {
    currentSkillPoolId = id;
    document.querySelectorAll("#skill-combobox-options .combobox-option").forEach(el => {
        el.classList.toggle("selected", parseInt(el.dataset.id, 10) === id);
    });

    // Limpa o termo de busca (UX de autocomplete)
    const searchInput = document.getElementById("skill-search-input");
    if (searchInput) {
        searchInput.value = "";
        filterSkillPool(); // repopula sem filtro
        searchInput.focus();
    }

    updateComboboxLabel();
    updateSkillPoolPreview();
    closeCombobox();
}

function updateComboboxLabel() {
    const label = document.getElementById("skill-combobox-label");
    if (!label) return;
    const skill = allSkills.find(s => s.id === currentSkillPoolId);

    if (skill) {
        label.innerHTML = `
            <img src="/static/assets/skill_icons/${skill.icon_kind}.avif" class="skill-icon-sm" alt="">
            <span class="combobox-selected-name">${skill.name}</span>
            <span class="combobox-selected-lv">Máx ${skill.max_level}</span>
        `;
    } else {
        label.innerHTML = `<span class="combobox-placeholder">Selecione uma habilidade...</span>`;
    }
}

/* ===================== Tooltip flutuante ===================== */

function showSkillTooltip(anchorEl, skill) {
    const tip = document.getElementById("skill-tooltip");
    if (!tip) return;

    tip.innerHTML = `
        <div class="skill-tooltip-header">
            <img src="/static/assets/skill_icons/${skill.icon_kind}.avif" alt="">
            <div>
                <div class="skill-tooltip-name">${skill.name}</div>
                <span class="skill-tooltip-meta">Nível Máximo: ${skill.max_level}</span>
            </div>
        </div>
        <div class="skill-tooltip-desc">${skill.description || "Sem descrição disponível."}</div>
    `;

    // Medir primeiro, posicionar depois (evita "pulo")
    tip.style.display = "block";
    tip.style.visibility = "hidden";

    const rect = anchorEl.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();
    const gap = 12;

    // Tenta abrir à direita; se não couber, abre à esquerda
    let left = rect.right + gap;
    if (left + tipRect.width > window.innerWidth - 8) {
        left = rect.left - tipRect.width - gap;
    }
    if (left < 8) left = 8;

    // Centraliza verticalmente em relação à opção, sem sair da tela
    let top = rect.top + rect.height / 2 - tipRect.height / 2;
    top = Math.max(8, Math.min(top, window.innerHeight - tipRect.height - 8));

    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
    tip.style.visibility = "visible";
}

function hideSkillTooltip() {
    const tip = document.getElementById("skill-tooltip");
    if (tip) tip.style.display = "none";
}

/* ===================== Lista de prioridades ===================== */

function populateSelects() {
    const weaponSelect = document.getElementById("weapon-select");
    weaponSelect.innerHTML = "";
    allWeapons.forEach(w => {
        const opt = document.createElement("option");
        opt.value = w.id;
        const slotsStr = w.slots && w.slots.length > 0 ? ` [Encaixes: ${w.slots.join('-')}]` : '';
        opt.textContent = `${w.name} (${w.kind.toUpperCase()})${slotsStr}`;
        weaponSelect.appendChild(opt);
    });

    const charmSelect = document.getElementById("charm-select");
    charmSelect.innerHTML = '<option value="">Deixar o Otimizador Escolher</option>';
    allCharms.forEach(c => {
        const opt = document.createElement("option");
        opt.value = c.id;
        opt.textContent = c.name;
        charmSelect.appendChild(opt);
    });

    filterSkillPool();
}

function renderSkillList() {
    const container = document.getElementById("skill-list");
    if (selectedSkills.length === 0) {
        container.innerHTML = `<div class="empty-state-skills">Nenhuma habilidade adicionada ainda. Selecione acima ou clique num conjunto sugerido.</div>`;
        return;
    }

    container.innerHTML = "";
    selectedSkills.forEach((item, index) => {
        const skill = allSkills.find(s => s.id === item.id);
        const sid = item.id;
        const minLvl = item.min_level || 0;
        const maxLvl = skill ? skill.max_level : 7;
        const hasRestriction = minLvl > 0;

        const div = document.createElement("div");
        div.className = "skill-priority-item";
        div.innerHTML = `
            <div class="skill-priority-header">
                <div class="skill-info">
                    <span class="priority-badge">#${index + 1}</span>
                    <img src="/static/assets/skill_icons/${skill ? skill.icon_kind : 'utility'}.avif" class="skill-icon-sm" alt="icon">
                    <span class="skill-name">${skill ? skill.name : 'Habilidade ' + sid}</span>
                </div>
                <div class="skill-controls">
                    <button class="btn-icon-small ${hasRestriction ? 'active-restr' : ''}" onclick="toggleRestriction(${index})" title="Restrição Mínima">
                        ⚙️
                    </button>
                    <button class="btn-icon-small" onclick="moveUp(${index})" title="Subir Prioridade" ${index === 0 ? 'disabled style="opacity:0.3; cursor:not-allowed;"' : ''}>↑</button>
                    <button class="btn-icon-small" onclick="moveDown(${index})" title="Descer Prioridade" ${index === selectedSkills.length - 1 ? 'disabled style="opacity:0.3; cursor:not-allowed;"' : ''}>↓</button>
                    <button class="btn-icon-small delete" onclick="removeSkill(${index})" title="Remover">✕</button>
                </div>
            </div>
            <div class="skill-desc-text">${skill ? skill.description : ''}</div>
            
            <div class="restriction-box" id="restriction-box-${index}" style="display: ${hasRestriction ? 'block' : 'none'};">
                <div class="restriction-header">
                    <span>Exigir Nível Mínimo na Build: <strong id="min-level-val-${index}">${minLvl}</strong> / ${maxLvl}</span>
                    <button class="btn-text-small red" onclick="clearRestriction(${index})">Remover Restrição</button>
                </div>
                <input type="range" min="1" max="${maxLvl}" value="${minLvl || 1}" class="restriction-slider" oninput="updateMinLevel(${index}, this.value)" />
            </div>
        `;
        container.appendChild(div);
    });
}

function moveUp(index) {
    if (index > 0) {
        const temp = selectedSkills[index];
        selectedSkills[index] = selectedSkills[index - 1];
        selectedSkills[index - 1] = temp;
        renderSkillList();
    }
}

function moveDown(index) {
    if (index < selectedSkills.length - 1) {
        const temp = selectedSkills[index];
        selectedSkills[index] = selectedSkills[index + 1];
        selectedSkills[index + 1] = temp;
        renderSkillList();
    }
}

function removeSkill(index) {
    selectedSkills.splice(index, 1);
    renderSkillList();
}

function toggleRestriction(index) {
    if (!selectedSkills[index]) return;
    if (selectedSkills[index].min_level && selectedSkills[index].min_level > 0) {
        selectedSkills[index].min_level = null;
    } else {
        selectedSkills[index].min_level = 1;
    }
    renderSkillList();
}

function clearRestriction(index) {
    if (!selectedSkills[index]) return;
    selectedSkills[index].min_level = null;
    renderSkillList();
}

function updateMinLevel(index, val) {
    if (!selectedSkills[index]) return;
    const num = parseInt(val);
    selectedSkills[index].min_level = num;
    const label = document.getElementById(`min-level-val-${index}`);
    if (label) label.textContent = num;
}

function addPreset(presetKey) {
    const names = SKILL_PRESETS[presetKey] || [];
    let addedCount = 0;

    names.forEach(targetName => {
        const match = allSkills.find(s => s.name.toLowerCase() === targetName.toLowerCase() || s.name.toLowerCase().includes(targetName.toLowerCase()));
        if (match && !selectedSkills.some(item => item.id === match.id)) {
            selectedSkills.push({ id: match.id, min_level: null });
            addedCount++;
        }
    });

    if (addedCount > 0) {
        renderSkillList();
    }
}

window.moveUp = moveUp;
window.moveDown = moveDown;
window.removeSkill = removeSkill;
window.toggleRestriction = toggleRestriction;
window.clearRestriction = clearRestriction;
window.updateMinLevel = updateMinLevel;
window.addPreset = addPreset;

document.getElementById("add-skill").addEventListener("click", () => {
    const sid = currentSkillPoolId;
    if (sid && !selectedSkills.some(item => item.id === sid)) {
        selectedSkills.push({ id: sid, min_level: null });
        renderSkillList();
    }
});

document.getElementById("optimize-btn").addEventListener("click", async () => {
    const weaponId = parseInt(document.getElementById("weapon-select").value);
    const charmVal = document.getElementById("charm-select").value;
    const charmId = charmVal ? parseInt(charmVal) : null;

    if (selectedSkills.length === 0) {
        alert("Por favor, adicione pelo menos uma habilidade desejada à lista de prioridades.");
        return;
    }

    // UI Loading state
    document.getElementById("results-placeholder").style.display = "none";
    document.getElementById("results-content").style.display = "none";
    document.getElementById("loading-spinner").style.display = "block";

    // Formatar payload das habilidades alvos
    const targetPayload = selectedSkills.map(item => {
        if (item.min_level && item.min_level > 0) {
            return { id: item.id, min_level: item.min_level };
        }
        return item.id;
    });

    try {
        const resp = await fetch("/optimize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                target_skills: targetPayload,
                weapon_id: weaponId,
                charm_id: charmId
            })
        });

        document.getElementById("loading-spinner").style.display = "none";

        if (!resp.ok) {
            const err = await resp.json();
            alert("Erro na otimização: " + (err.detail || "Falha ao calcular a build."));
            document.getElementById("results-placeholder").style.display = "block";
            return;
        }

        const result = await resp.json();
        displayResults(result);
    } catch (err) {
        document.getElementById("loading-spinner").style.display = "none";
        document.getElementById("results-placeholder").style.display = "block";
        alert("Ocorreu um erro ao se comunicar com o servidor.");
        console.error(err);
    }
});

function displayResults(result) {
    // 1. Resumo Geral das Habilidades (Desejadas Ativadas, Desejadas NÃO Ativadas, Extras Bônus)
    const skillsGrid = document.getElementById("skills-summary-grid");
    skillsGrid.innerHTML = "";

    for (const [skillName, info] of Object.entries(result.skills)) {
        const pct = info.max_level > 0 ? Math.min(100, Math.round((info.level / info.max_level) * 100)) : 0;

        let cardClass = "skill-summary-card";
        let statusBadge = "";
        const iconKind = info.icon_kind || 'utility';

        if (info.status_type === "target_acquired") {
            cardClass += " is-target";
            statusBadge = `<span class="priority-badge">Prioridade #${info.priority}</span>`;
        } else if (info.status_type === "target_unacquired") {
            cardClass += " is-unacquired";
            statusBadge = `<span class="badge-unacquired">❌ Desejada (NÃO ativada)</span>`;
        } else {
            cardClass += " is-extra";
            statusBadge = `<span class="badge-extra">🎁 Bônus Nativo</span>`;
        }

        let restrictionBadge = "";
        if (info.min_required && info.min_required > 0) {
            restrictionBadge = `<span class="badge-restr-tag">⚙️ Exigido: Nív. ${info.min_required}</span>`;
        }

        let overflowBadge = "";
        if (info.overflow > 0) {
            overflowBadge = `<div class="overflow-warning">⚠️ Sobra: +${info.overflow} ponto(s) desperdiçado(s) além do máximo (${info.max_level})</div>`;
        }

        let sourcesHtml = "";
        if (info.sources && info.sources.length > 0) {
            sourcesHtml += `<div class="skill-sources-box">
                <div class="sources-title">Origem dos Pontos:</div>
                <ul class="sources-list">`;
            info.sources.forEach(src => {
                let icon = '🛡️';
                if (src.type === 'weapon_native') icon = '⚔️';
                else if (src.type === 'charm_native') icon = '📿';
                else if (src.type === 'decoration') icon = '💎';

                sourcesHtml += `<li><span>${icon} ${src.source}</span> <strong>+${src.level}</strong></li>`;
            });
            sourcesHtml += `</ul></div>`;
        }

        const card = document.createElement("div");
        card.className = cardClass;
        card.innerHTML = `
            <div class="skill-summary-header">
                <div class="skill-title-with-icon">
                    <img src="/static/assets/skill_icons/${iconKind}.avif" class="skill-icon-sm" alt="icon">
                    <span class="skill-summary-name">${skillName}</span>
                </div>
                ${statusBadge}
            </div>
            ${restrictionBadge ? `<div style="margin-bottom:0.4rem;">${restrictionBadge}</div>` : ''}
            <div class="skill-level-row">
                <span>Nível Final:</span>
                <span class="skill-level-text">Nív. ${info.level} / ${info.max_level}</span>
            </div>
            <div class="progress-bar-bg">
                <div class="progress-bar-fill ${info.status_type === 'target_unacquired' ? 'fill-unacquired' : ''}" style="width: ${pct}%;"></div>
            </div>
            ${overflowBadge}
            ${sourcesHtml}
        `;
        skillsGrid.appendChild(card);
    }

    // 2. Equipamentos & Gemas
    const equipGrid = document.getElementById("equipment-grid");
    equipGrid.innerHTML = "";

    // Arma (incluindo habilidades nativas)
    if (result.weapon) {
        equipGrid.appendChild(createEquipCard("Arma", result.weapon.name, result.weapon.skills || [], result.weapon.slots || []));
    }

    // Peças de Armadura
    const kindNames = {
        "head": "Cabeça",
        "chest": "Peito",
        "arms": "Braços",
        "waist": "Cintura",
        "legs": "Pernas"
    };

    result.armor.forEach(a => {
        const label = kindNames[a.kind] || a.kind;
        equipGrid.appendChild(createEquipCard(label, a.name, a.skills || [], a.slots || []));
    });

    // Amuleto
    if (result.charm) {
        equipGrid.appendChild(createEquipCard("Amuleto", result.charm.name, result.charm.skills || [], []));
    }

    document.getElementById("results-content").style.display = "block";
}

function createEquipCard(kindLabel, name, nativeSkills, slots) {
    const card = document.createElement("div");
    card.className = "equip-item-card";

    let skillsHtml = "";
    if (nativeSkills.length > 0) {
        skillsHtml += `<div class="equip-section-title">Habilidades Nativas:</div><ul class="native-skills-list">`;
        nativeSkills.forEach(s => {
            skillsHtml += `<li><span>${s.name}</span><strong>+${s.level}</strong></li>`;
        });
        skillsHtml += `</ul>`;
    }

    let slotsHtml = "";
    if (slots.length > 0) {
        slotsHtml += `<div class="equip-section-title">Encaixes (Slots & Gemas):</div><div class="slots-breakdown">`;
        slots.forEach((s, idx) => {
            const slotLvlClass = `lvl-${s.slot_size}`;
            if (s.decoration) {
                slotsHtml += `
                    <div class="slot-row">
                        <span class="slot-size-badge ${slotLvlClass}">Nív. ${s.slot_size}</span>
                        <span class="slot-gem-name">💎 ${s.decoration.name}</span>
                    </div>
                `;
            } else {
                slotsHtml += `
                    <div class="slot-row">
                        <span class="slot-size-badge ${slotLvlClass}">Nív. ${s.slot_size}</span>
                        <span class="slot-empty">⚪ Encaixe Vazio</span>
                    </div>
                `;
            }
        });
        slotsHtml += `</div>`;
    }

    card.innerHTML = `
        <span class="equip-kind-badge">${kindLabel}</span>
        <div class="equip-name">${name}</div>
        ${skillsHtml}
        ${slotsHtml}
    `;

    return card;
}

loadData();