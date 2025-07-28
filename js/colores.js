import { db } from './firebase-config.js';
import { collection, query, orderBy, onSnapshot, addDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { setAllColores, allColores } from './main.js';
import { showModalMessage, hideModal } from './ui.js';

export function setupColoresEventListeners() {
    document.getElementById('add-color-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const nuevoColor = {
            nombre: document.getElementById('nuevo-color-nombre').value,
            creadoEn: new Date()
        };
        showModalMessage("Registrando color...", true);
        try {
            await addDoc(collection(db, "colores"), nuevoColor);
            e.target.reset();
            hideModal();
            showModalMessage("¡Color registrado!", false, 2000);
        } catch (error) {
            console.error(error);
            hideModal();
            showModalMessage("Error al registrar color.");
        }
    });
    document.getElementById('search-colores').addEventListener('input', renderColores);
}

export function loadColores() {
    const q = query(collection(db, "colores"), orderBy("nombre", "asc"));
    onSnapshot(q, (snapshot) => {
        const colores = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setAllColores(colores);
        renderColores();
    });
}

function renderColores() {
    const coloresListEl = document.getElementById('colores-list');
    if (!coloresListEl) return;
    const searchTerm = document.getElementById('search-colores').value.toLowerCase();
    const filtered = allColores.filter(c => c.nombre.toLowerCase().includes(searchTerm));
    
    coloresListEl.innerHTML = '';
    if (filtered.length === 0) { coloresListEl.innerHTML = '<p>No hay colores.</p>'; return; }
    filtered.forEach(color => {
        const colorDiv = document.createElement('div');
        colorDiv.className = 'border p-4 rounded-lg font-semibold';
        colorDiv.textContent = color.nombre;
        coloresListEl.appendChild(colorDiv);
    });
}
