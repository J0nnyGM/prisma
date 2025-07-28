import { db } from './firebase-config.js';
import { collection, query, orderBy, onSnapshot, addDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { setAllItems, allItems } from './main.js';
import { showModalMessage, hideModal } from './ui.js';

export function setupItemsEventListeners() {
    document.getElementById('add-item-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const nuevoItem = {
            referencia: document.getElementById('nuevo-item-ref').value,
            descripcion: document.getElementById('nuevo-item-desc').value,
            creadoEn: new Date()
        };
        showModalMessage("Registrando ítem...", true);
        try {
            await addDoc(collection(db, "items"), nuevoItem);
            e.target.reset();
            hideModal();
            showModalMessage("¡Ítem registrado!", false, 2000);
        } catch (error) {
            console.error(error);
            hideModal();
            showModalMessage("Error al registrar ítem.");
        }
    });
    document.getElementById('search-items').addEventListener('input', renderItems);
}

export function loadItems() {
    const q = query(collection(db, "items"), orderBy("referencia", "asc"));
    onSnapshot(q, (snapshot) => {
        const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setAllItems(items);
        renderItems();
    });
}

function renderItems() {
    const itemsListEl = document.getElementById('items-list');
    if (!itemsListEl) return;
    const searchTerm = document.getElementById('search-items').value.toLowerCase();
    const filtered = allItems.filter(i => i.referencia.toLowerCase().includes(searchTerm) || i.descripcion.toLowerCase().includes(searchTerm));

    itemsListEl.innerHTML = '';
    if (filtered.length === 0) { itemsListEl.innerHTML = '<p>No hay ítems.</p>'; return; }
    filtered.forEach(item => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'border p-4 rounded-lg';
        itemDiv.innerHTML = `<p class="font-semibold"><span class="item-ref">${item.referencia}</span> ${item.descripcion}</p>`;
        itemsListEl.appendChild(itemDiv);
    });
}
