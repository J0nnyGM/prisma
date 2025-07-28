import { db } from './firebase-config.js';
import { collection, query, orderBy, onSnapshot, addDoc, doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { setAllProveedores, allProveedores, currentUserData } from './main.js';
import { showModalMessage, hideModal } from './ui.js';

export function setupProveedoresEventListeners() {
    document.getElementById('add-proveedor-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const nuevoProveedor = {
            nombre: document.getElementById('nuevo-proveedor-nombre').value,
            contacto: document.getElementById('nuevo-proveedor-contacto').value,
            telefono: document.getElementById('nuevo-proveedor-telefono').value,
            email: document.getElementById('nuevo-proveedor-email').value,
            creadoEn: new Date(),
        };
        showModalMessage("Registrando proveedor...", true);
        try {
            await addDoc(collection(db, "proveedores"), nuevoProveedor);
            e.target.reset();
            hideModal();
            showModalMessage("¡Proveedor registrado!", false, 2000);
        } catch (error) {
            console.error("Error al registrar proveedor:", error);
            hideModal();
            showModalMessage("Error al registrar el proveedor.");
        }
    });
    document.getElementById('search-proveedores').addEventListener('input', renderProveedores);
}

export function loadProveedores() {
    const q = query(collection(db, "proveedores"), orderBy("nombre", "asc"));
    onSnapshot(q, (snapshot) => {
        const proveedores = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setAllProveedores(proveedores);
        renderProveedores();
    });
}

function renderProveedores() {
    const proveedoresListEl = document.getElementById('proveedores-list');
    if (!proveedoresListEl) return;
    const searchTerm = document.getElementById('search-proveedores').value.toLowerCase();
    const filtered = allProveedores.filter(p => p.nombre.toLowerCase().includes(searchTerm));

    proveedoresListEl.innerHTML = '';
    if (filtered.length === 0) { proveedoresListEl.innerHTML = '<p>No hay proveedores registrados.</p>'; return; }
    
    filtered.forEach(proveedor => {
        const el = document.createElement('div');
        el.className = 'border p-4 rounded-lg flex justify-between items-center';
        const editButton = (currentUserData && currentUserData.role === 'admin') 
            ? `<button data-provider-json='${JSON.stringify(proveedor)}' class="edit-provider-btn bg-gray-200 text-gray-700 px-3 py-1 rounded-lg text-sm font-semibold hover:bg-gray-300">Editar</button>`
            : '';
        el.innerHTML = `
            <div class="flex-grow">
                <p class="font-semibold">${proveedor.nombre}</p>
                <p class="text-sm text-gray-600">${proveedor.email || ''} | ${proveedor.telefono || ''}</p>
            </div>
            ${editButton}
        `;
        proveedoresListEl.appendChild(el);
    });
    document.querySelectorAll('.edit-provider-btn').forEach(btn => btn.addEventListener('click', (e) => showEditProviderModal(JSON.parse(e.currentTarget.dataset.providerJson))));
}

function showEditProviderModal(provider) {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    modalContentWrapper.innerHTML = `<div class="bg-white rounded-lg p-6 shadow-xl max-w-sm w-full mx-auto text-center"><h2 class="text-xl font-semibold mb-4">Editar Proveedor</h2><form id="edit-provider-form" class="space-y-4 text-left"><input type="hidden" id="edit-provider-id" value="${provider.id}"><div><label for="edit-provider-name" class="block text-sm font-medium text-gray-700">Nombre</label><input type="text" id="edit-provider-name" class="w-full p-2 border border-gray-300 rounded-lg mt-1" value="${provider.nombre}" required></div><div><label for="edit-provider-contact" class="block text-sm font-medium text-gray-700">Contacto</label><input type="text" id="edit-provider-contact" class="w-full p-2 border border-gray-300 rounded-lg mt-1" value="${provider.contacto || ''}"></div><div><label for="edit-provider-phone" class="block text-sm font-medium text-gray-700">Teléfono</label><input type="tel" id="edit-provider-phone" class="w-full p-2 border border-gray-300 rounded-lg mt-1" value="${provider.telefono || ''}"></div><div><label for="edit-provider-email" class="block text-sm font-medium text-gray-700">Correo</label><input type="email" id="edit-provider-email" class="w-full p-2 border border-gray-300 rounded-lg mt-1" value="${provider.email || ''}"></div><div class="flex gap-4 justify-end pt-4"><button type="button" id="cancel-edit-btn" class="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg font-semibold">Cancelar</button><button type="submit" class="bg-indigo-600 text-white px-4 py-2 rounded-lg font-semibold">Guardar Cambios</button></div></form></div>`;
    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('cancel-edit-btn').addEventListener('click', hideModal);
    document.getElementById('edit-provider-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const providerId = document.getElementById('edit-provider-id').value;
        const updatedData = {
            nombre: document.getElementById('edit-provider-name').value,
            contacto: document.getElementById('edit-provider-contact').value,
            telefono: document.getElementById('edit-provider-phone').value,
            email: document.getElementById('edit-provider-email').value,
        };
        showModalMessage("Actualizando proveedor...", true);
        try {
            await updateDoc(doc(db, "proveedores", providerId), updatedData);
            hideModal();
            showModalMessage("¡Proveedor actualizado!", false, 2000);
        } catch (error) {
            console.error("Error al actualizar proveedor:", error);
            showModalMessage("Error al actualizar.");
        }
    });
}
