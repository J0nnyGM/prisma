// js/modules/colores.js

import { db } from '../firebase-config.js';
import { collection, addDoc, query, onSnapshot, serverTimestamp, where } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { allColores, setAllColores, showModalMessage } from '../app.js';
import { normalizeText } from '../utils.js';

const CACHE_KEY = 'colores_cache';

export function loadColores() {
    const cachedData = localStorage.getItem(CACHE_KEY);
    let mapColores = new Map();
    let maxLastUpdated = 0;

    if (cachedData) {
        try {
            const parsedData = JSON.parse(cachedData);
            parsedData.forEach(c => {
                mapColores.set(c.id, c);
                if (c._lastUpdated && c._lastUpdated > maxLastUpdated) {
                    maxLastUpdated = c._lastUpdated;
                }
            });
            setAllColores(Array.from(mapColores.values()));
            renderColores();
        } catch (e) {
            console.warn("Caché de colores corrupto. Se limpiará.", e);
            localStorage.removeItem(CACHE_KEY);
        }
    }

    const colRef = collection(db, "colores");
    let q;

    if (maxLastUpdated > 0) {
        const syncTime = new Date(maxLastUpdated - 120000);
        q = query(colRef, where("_lastUpdated", ">=", syncTime));
    } else {
        q = query(colRef);
    }

    let isInitial = true;
    const unsubscribe = onSnapshot(q, (snapshot) => {
        let huboCambios = false;

        snapshot.docChanges().forEach((change) => {
            const doc = change.doc;
            const data = doc.data();

            if (data._lastUpdated && typeof data._lastUpdated.toMillis === 'function') data._lastUpdated = data._lastUpdated.toMillis();
            if (data.creadoEn && typeof data.creadoEn.toMillis === 'function') data.creadoEn = data.creadoEn.toMillis();

            if (change.type === "added" || change.type === "modified") {
                mapColores.set(doc.id, { id: doc.id, ...data });
                huboCambios = true;
            }
            if (change.type === "removed") {
                mapColores.delete(doc.id);
                huboCambios = true;
            }
        });

        if (huboCambios) {
            const finalArray = Array.from(mapColores.values());
            finalArray.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));

            localStorage.setItem(CACHE_KEY, JSON.stringify(finalArray));
            setAllColores(finalArray);
            renderColores();
            if (!isInitial) {
                console.log(`[Colores] ${snapshot.docChanges().length} cambios detectados.`);
            }
        }
        isInitial = false;
    }, (error) => {
        console.error("Error en onSnapshot diferencial de colores:", error);
    });

    return unsubscribe;
}

export function renderColores() {
    const coloresListEl = document.getElementById('colores-list');
    if (!coloresListEl) return;
    
    const searchInput = document.getElementById('search-colores');
    const searchTerm = searchInput ? normalizeText(searchInput.value) : '';
    
    const filtered = allColores.filter(c => normalizeText(c.nombre).includes(searchTerm));

    coloresListEl.innerHTML = '';
    if (filtered.length === 0) { 
        coloresListEl.innerHTML = '<p class="text-center text-gray-500 py-8">No hay colores registrados.</p>'; 
        return; 
    }
    
    filtered.forEach(color => {
        const colorDiv = document.createElement('div');
        colorDiv.className = 'premium-card premium-card-orange p-4 flex items-center gap-4 bg-white shadow-sm hover:shadow-md transition';
        
        const firstLetter = (color.nombre || 'C').charAt(0).toUpperCase();
        
        colorDiv.innerHTML = `
            <div class="premium-avatar premium-avatar-orange flex-shrink-0">${firstLetter}</div>
            <div class="flex-grow min-w-0">
                <p class="font-bold text-slate-800 text-base truncate" title="${color.nombre}">${color.nombre}</p>
                <p class="text-[10px] text-slate-450 mt-0.5">Pintura Electrostática</p>
            </div>
        `;
        coloresListEl.appendChild(colorDiv);
    });
}

export function setupColoresEvents() {
    const openBtn = document.getElementById('mobile-add-color-btn');
    const modal = document.getElementById('color-form-container');

    const addForm = document.getElementById('add-color-form');
    if (addForm) {
        addForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const nuevoColor = {
                nombre: document.getElementById('nuevo-color-nombre').value,
                creadoEn: serverTimestamp(),
                _lastUpdated: serverTimestamp()
            };
            showModalMessage("Registrando color...", true);
            try {
                await addDoc(collection(db, "colores"), nuevoColor);
                e.target.reset();
                if (modal) modal.classList.remove('show-modal');
                showModalMessage("¡Color registrado!", false, 2000);
            } catch (error) {
                console.error("Error al registrar color:", error);
                showModalMessage("Error al registrar color.");
            }
        });
    }
    const searchInput = document.getElementById('search-colores');
    if (searchInput) {
        searchInput.addEventListener('input', renderColores);
    }
}
