import { db } from './firebase-config.js';
import { collection, query, orderBy, onSnapshot, addDoc, doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { setAllClientes, allClientes, allRemisiones, currentUserData } from './main.js';
import { showModalMessage, hideModal, formatCurrency } from './ui.js';

export function setupClientesEventListeners() {
    document.getElementById('add-cliente-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const nuevoCliente = {
            nombre: document.getElementById('nuevo-cliente-nombre').value,
            email: document.getElementById('nuevo-cliente-email').value,
            telefono1: document.getElementById('nuevo-cliente-telefono1').value,
            telefono2: document.getElementById('nuevo-cliente-telefono2').value,
            nit: document.getElementById('nuevo-cliente-nit').value || '',
            creadoEn: new Date()
        };
        showModalMessage("Registrando cliente...", true);
        try {
            await addDoc(collection(db, "clientes"), nuevoCliente);
            e.target.reset();
            hideModal();
            showModalMessage("¡Cliente registrado!", false, 2000);
        } catch (error) {
            console.error(error);
            hideModal();
            showModalMessage("Error al registrar cliente.");
        }
    });
    document.getElementById('search-clientes').addEventListener('input', renderClientes);
}

export function loadClientes() {
    const q = query(collection(db, "clientes"), orderBy("nombre", "asc"));
    onSnapshot(q, (snapshot) => {
        const clientes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setAllClientes(clientes);
        renderClientes();
    });
}

export function renderClientes() {
    const clientesListEl = document.getElementById('clientes-list');
    if (!clientesListEl) return;
    const searchTerm = document.getElementById('search-clientes')?.value.toLowerCase() || '';
    
    const clientesConHistorial = allClientes.map(cliente => {
        const remisionesCliente = allRemisiones.filter(r => r.idCliente === cliente.id && r.estado !== 'Anulada');
        const totalComprado = remisionesCliente.reduce((sum, r) => sum + r.valorTotal, 0);
        let ultimaCompra = 'N/A';
        if (remisionesCliente.length > 0) {
            remisionesCliente.sort((a, b) => new Date(b.fechaRecibido) - new Date(a.fechaRecibido));
            ultimaCompra = remisionesCliente[0].fechaRecibido;
        }
        return { ...cliente, totalComprado, ultimaCompra };
    });

    const filtered = clientesConHistorial.filter(c => 
        c.nombre.toLowerCase().includes(searchTerm) || 
        c.email.toLowerCase().includes(searchTerm) || 
        (c.telefono1 && c.telefono1.includes(searchTerm)) ||
        (c.telefono2 && c.telefono2.includes(searchTerm))
    );

    clientesListEl.innerHTML = '';
    if (filtered.length === 0) { 
        clientesListEl.innerHTML = '<p class="text-center text-gray-500 py-8">No se encontraron clientes.</p>'; 
        return; 
    }
    
    filtered.forEach(cliente => {
        const clienteDiv = document.createElement('div');
        clienteDiv.className = 'border p-4 rounded-lg flex justify-between items-start';
        const telefonos = [cliente.telefono1, cliente.telefono2].filter(Boolean).join(' | ');
        const editButton = (currentUserData && currentUserData.role === 'admin') 
            ? `<button data-client-json='${JSON.stringify(cliente)}' class="edit-client-btn bg-gray-200 text-gray-700 px-3 py-1 rounded-lg text-sm font-semibold hover:bg-gray-300 w-full text-center">Editar</button>`
            : '';

        clienteDiv.innerHTML = `
            <div class="flex-grow">
                <p class="font-semibold text-lg">${cliente.nombre}</p>
                <p class="text-sm text-gray-600">${cliente.email} | ${telefonos}</p>
                ${cliente.nit ? `<p class="text-sm text-gray-500">NIT: ${cliente.nit}</p>` : ''}
                <div class="mt-2 pt-2 border-t border-gray-100 text-sm">
                    <p><span class="font-semibold">Última Compra:</span> ${cliente.ultimaCompra}</p>
                    <p><span class="font-semibold">Total Comprado:</span> ${formatCurrency(cliente.totalComprado)}</p>
                </div>
            </div>
            <div class="flex-shrink-0 flex flex-col items-end gap-2">
                 ${editButton}
            </div>
        `;
        clientesListEl.appendChild(clienteDiv);
    });
    document.querySelectorAll('.edit-client-btn').forEach(btn => btn.addEventListener('click', (e) => showEditClientModal(JSON.parse(e.currentTarget.dataset.clientJson))));
}

function showEditClientModal(client) {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    modalContentWrapper.innerHTML = `<div class="bg-white rounded-lg p-6 shadow-xl max-w-sm w-full mx-auto text-center"><h2 class="text-xl font-semibold mb-4">Editar Cliente</h2><form id="edit-client-form" class="space-y-4 text-left"><input type="hidden" id="edit-client-id" value="${client.id}"><div><label for="edit-client-name" class="block text-sm font-medium text-gray-700">Nombre</label><input type="text" id="edit-client-name" class="w-full p-2 border border-gray-300 rounded-lg mt-1" value="${client.nombre}" required></div><div><label for="edit-client-email" class="block text-sm font-medium text-gray-700">Correo</label><input type="email" id="edit-client-email" class="w-full p-2 border border-gray-300 rounded-lg mt-1" value="${client.email}" required></div><div><label for="edit-client-phone1" class="block text-sm font-medium text-gray-700">Teléfono 1</label><input type="tel" id="edit-client-phone1" class="w-full p-2 border border-gray-300 rounded-lg mt-1" value="${client.telefono1 || ''}" required></div><div><label for="edit-client-phone2" class="block text-sm font-medium text-gray-700">Teléfono 2</label><input type="tel" id="edit-client-phone2" class="w-full p-2 border border-gray-300 rounded-lg mt-1" value="${client.telefono2 || ''}"></div><div><label for="edit-client-nit" class="block text-sm font-medium text-gray-700">NIT</label><input type="text" id="edit-client-nit" class="w-full p-2 border border-gray-300 rounded-lg mt-1" value="${client.nit || ''}"></div><div class="flex gap-4 justify-end pt-4"><button type="button" id="cancel-edit-btn" class="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg font-semibold">Cancelar</button><button type="submit" class="bg-indigo-600 text-white px-4 py-2 rounded-lg font-semibold">Guardar Cambios</button></div></form></div>`;
    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('cancel-edit-btn').addEventListener('click', hideModal);
    document.getElementById('edit-client-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const clientId = document.getElementById('edit-client-id').value;
        const updatedData = {
            nombre: document.getElementById('edit-client-name').value,
            email: document.getElementById('edit-client-email').value,
            telefono1: document.getElementById('edit-client-phone1').value,
            telefono2: document.getElementById('edit-client-phone2').value,
            nit: document.getElementById('edit-client-nit').value,
        };
        showModalMessage("Actualizando cliente...", true);
        try {
            await updateDoc(doc(db, "clientes", clientId), updatedData);
            hideModal();
            showModalMessage("¡Cliente actualizado!", false, 2000);
        } catch (error) {
            console.error("Error al actualizar cliente:", error);
            showModalMessage("Error al actualizar.");
        }
    });
}
