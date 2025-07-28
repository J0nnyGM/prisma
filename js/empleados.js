import { db, storage } from './firebase-config.js';
import { collection, query, onSnapshot, doc, updateDoc, deleteDoc, where, getDocs, addDoc, arrayUnion } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { updateEmail } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { currentUser, currentUserData, allRemisiones, allGastos, allClientes } from './main.js';
import { showModalMessage, hideModal, formatCurrency, unformatCurrency, autoFormatCurrency, populateDateFilters } from './ui.js';

let profitLossChart = null;
const RRHH_DOCUMENT_TYPES = [
    { id: 'contrato', name: 'Contrato' },
    { id: 'hojaDeVida', name: 'Hoja de Vida' },
    { id: 'examenMedico', name: 'Examen Médico' },
    { id: 'cedula', name: 'Cédula (PDF)' },
    { id: 'certificadoARL', name: 'Certificado ARL' },
    { id: 'certificadoEPS', name: 'Certificado EPS' },
    { id: 'certificadoAFP', name: 'Certificado AFP' },
    { id: 'cartaRetiro', name: 'Carta de renuncia o despido' },
    { id: 'liquidacionDoc', name: 'Liquidación' },
];

export function setupEmpleadoEventListeners() {
    // These listeners are attached to buttons in the main UI, not inside a specific view.
    // That's why they are here, to be called once at the beginning.
    document.getElementById('summary-btn').addEventListener('click', showDashboardModal);
    document.getElementById('edit-profile-btn').addEventListener('click', showEditProfileModal);
    document.getElementById('loan-request-btn').addEventListener('click', showLoanRequestModal);
}

export function loadEmpleados() {
    const empleadosListEl = document.getElementById('empleados-list');
    if (!currentUserData || !currentUserData.role || currentUserData.role.toLowerCase() !== 'admin' || !empleadosListEl) {
        return;
    }
    const q = query(collection(db, "users"));
    onSnapshot(q, (snapshot) => {
        const users = snapshot.docs.map(d => ({id: d.id, ...d.data()}));
        empleadosListEl.innerHTML = '';
        users.filter(u => u.id !== currentUser.uid).forEach(empleado => {
            const el = document.createElement('div');
            el.className = 'border p-4 rounded-lg flex justify-between items-center';
            el.innerHTML = `
                <div>
                    <p class="font-semibold">${empleado.nombre} <span class="text-sm font-normal text-gray-500">(${empleado.role})</span></p>
                    <p class="text-sm text-gray-600">${empleado.email}</p>
                </div>
                <div class="flex flex-wrap gap-2">
                    <button data-user-json='${JSON.stringify(empleado)}' class="manage-rrhh-docs-btn bg-green-600 text-white px-3 py-1 rounded-lg text-sm font-semibold hover:bg-green-700">Recursos Humanos</button>
                    <button data-user-json='${JSON.stringify(empleado)}' class="manage-user-btn bg-blue-600 text-white px-3 py-1 rounded-lg text-sm font-semibold hover:bg-blue-700">Gestionar</button>
                    <button data-uid="${empleado.id}" class="delete-user-btn bg-red-600 text-white p-2 rounded hover:bg-red-700">Eliminar</button>
                </div>`;
            empleadosListEl.appendChild(el);
        });
        document.querySelectorAll('.manage-rrhh-docs-btn').forEach(btn => btn.addEventListener('click', (e) => showRRHHModal(JSON.parse(e.currentTarget.dataset.userJson))));
        document.querySelectorAll('.manage-user-btn').forEach(btn => btn.addEventListener('click', (e) => showAdminEditUserModal(JSON.parse(e.currentTarget.dataset.userJson))));
        document.querySelectorAll('.delete-user-btn').forEach(btn => { btn.addEventListener('click', async (e) => { const uid = e.target.dataset.uid; if (confirm('¿Estás seguro de que quieres eliminar este usuario? Esta acción no se puede deshacer.')) { showModalMessage("Eliminando usuario...", true); await deleteDoc(doc(db, "users", uid)); showModalMessage("Usuario eliminado de Firestore.", false, 2000); } }); });
    });
}

export function showDashboardModal() {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    modalContentWrapper.innerHTML = `
        <div class="bg-white rounded-lg shadow-xl w-full max-w-6xl mx-auto text-left flex flex-col" style="height: 90vh;">
            <div class="flex justify-between items-center p-4 border-b">
                <h2 class="text-xl font-semibold">Resumen del Negocio</h2>
                <button id="close-dashboard-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
            </div>
            <div class="border-b border-gray-200">
                <nav id="dashboard-nav" class="-mb-px flex space-x-6 px-6">
                    <button data-tab="resumen" class="dashboard-tab-btn active py-3 px-1 font-semibold">Resumen Mensual</button>
                    <button data-tab="cartera" class="dashboard-tab-btn py-3 px-1 font-semibold">Cartera</button>
                    <button data-tab="clientes" class="dashboard-tab-btn py-3 px-1 font-semibold">Clientes</button>
                </nav>
            </div>
            <div id="dashboard-content" class="p-6 overflow-y-auto flex-grow">
                <!-- Dashboard content will be rendered here -->
            </div>
        </div>
    `;
    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('close-dashboard-modal').addEventListener('click', hideModal);

    const dashboardContent = document.getElementById('dashboard-content');
    renderResumenMensualTab(dashboardContent); // Carga la primera pestaña por defecto

    document.querySelectorAll('.dashboard-tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.dashboard-tab-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            const tab = e.target.dataset.tab;
            
            switch(tab) {
                case 'resumen': renderResumenMensualTab(dashboardContent); break;
                case 'cartera': renderCarteraTab(dashboardContent); break;
                case 'clientes': renderClientesTab(dashboardContent); break;
            }
        });
    });
}

export function showEditProfileModal() {
    const user = currentUserData;
    if (!user) return;

    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    modalContentWrapper.innerHTML = `
        <div class="bg-white rounded-lg p-6 shadow-xl max-w-lg w-full mx-auto text-left">
            <div class="flex justify-between items-center mb-4">
                <h2 class="text-xl font-semibold">Editar Mi Perfil</h2>
                <button id="close-profile-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
            </div>
            <form id="edit-profile-form" class="space-y-4">
                <div><label for="profile-name" class="block text-sm font-medium">Nombre Completo</label><input type="text" id="profile-name" class="w-full p-2 border rounded-lg mt-1" value="${user.nombre || ''}" required></div>
                <div><label for="profile-cedula" class="block text-sm font-medium">Cédula</label><input type="text" id="profile-cedula" class="w-full p-2 border rounded-lg mt-1" value="${user.cedula || ''}" required></div>
                <div><label for="profile-dob" class="block text-sm font-medium">Fecha de Nacimiento</label><input type="date" id="profile-dob" class="w-full p-2 border rounded-lg mt-1" value="${user.dob || ''}" required></div>
                <div><label for="profile-email" class="block text-sm font-medium">Correo Electrónico</label><input type="email" id="profile-email" class="w-full p-2 border rounded-lg mt-1" value="${user.email || ''}" required></div>
                <div><label for="profile-address" class="block text-sm font-medium">Dirección</label><input type="text" id="profile-address" class="w-full p-2 border rounded-lg mt-1" value="${user.direccion || ''}"></div>
                <div class="flex justify-end pt-4">
                    <button type="submit" class="w-full bg-indigo-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-indigo-700">Guardar Cambios</button>
                </div>
            </form>
        </div>`;
    
    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('close-profile-modal').addEventListener('click', hideModal);
    document.getElementById('edit-profile-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const newEmail = document.getElementById('profile-email').value;
        const updatedData = {
            nombre: document.getElementById('profile-name').value,
            cedula: document.getElementById('profile-cedula').value,
            dob: document.getElementById('profile-dob').value,
            direccion: document.getElementById('profile-address').value,
            email: newEmail
        };

        showModalMessage("Guardando cambios...", true);
        try {
            await updateDoc(doc(db, "users", currentUser.uid), updatedData);
            if (currentUser.email !== newEmail) {
                await updateEmail(currentUser, newEmail);
            }
            hideModal();
            showModalMessage("Perfil actualizado con éxito.", false, 2000);
        } catch (error) {
            console.error("Error al actualizar perfil:", error);
            showModalMessage("Error al guardar los cambios.");
        }
    });
}

export function showLoanRequestModal() {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    modalContentWrapper.innerHTML = `
        <div class="bg-white rounded-lg p-6 shadow-xl max-w-lg w-full mx-auto text-left">
            <div class="flex justify-between items-center mb-4">
                <h2 class="text-xl font-semibold">Solicitud de Préstamo</h2>
                <button id="close-loan-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
            </div>
            <form id="loan-request-form" class="space-y-4 mb-6">
                <div>
                    <label for="loan-amount" class="block text-sm font-medium">Monto a Solicitar</label>
                    <input type="text" id="loan-amount" class="w-full p-2 border rounded-lg mt-1" inputmode="numeric" required>
                </div>
                <div>
                    <label for="loan-reason" class="block text-sm font-medium">Motivo</label>
                    <textarea id="loan-reason" class="w-full p-2 border rounded-lg mt-1" rows="3" required></textarea>
                </div>
                <button type="submit" class="w-full bg-yellow-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-yellow-700">Enviar Solicitud</button>
            </form>
            <div>
                <h3 class="text-lg font-semibold border-t pt-4">Mis Solicitudes</h3>
                <div id="my-loans-list" class="space-y-2 mt-2 max-h-60 overflow-y-auto">Cargando...</div>
            </div>
        </div>
    `;
    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('close-loan-modal').addEventListener('click', hideModal);
    
    const amountInput = document.getElementById('loan-amount');
    amountInput.addEventListener('input', autoFormatCurrency);

    document.getElementById('loan-request-form').addEventListener('submit', handleLoanRequestSubmit);

    const loansListEl = document.getElementById('my-loans-list');
    const q = query(collection(db, "prestamos"), where("employeeId", "==", currentUser.uid));
    onSnapshot(q, (snapshot) => {
        const prestamos = snapshot.docs.map(d => d.data());
        prestamos.sort((a, b) => new Date(b.requestDate) - new Date(a.requestDate));

        if (prestamos.length === 0) {
            loansListEl.innerHTML = '<p class="text-center text-gray-500 py-4">No tienes solicitudes de préstamo.</p>';
            return;
        }
        loansListEl.innerHTML = '';
        prestamos.forEach(p => {
            const el = document.createElement('div');
            el.className = 'border p-3 rounded-lg flex justify-between items-center';
            let statusBadge = '';
            switch(p.status) {
                case 'solicitado': statusBadge = `<span class="text-xs font-semibold bg-yellow-200 text-yellow-800 px-2 py-1 rounded-full">Solicitado</span>`; break;
                case 'aprobado': statusBadge = `<span class="text-xs font-semibold bg-blue-200 text-blue-800 px-2 py-1 rounded-full">Aprobado</span>`; break;
                case 'cancelado': statusBadge = `<span class="text-xs font-semibold bg-gray-200 text-gray-800 px-2 py-1 rounded-full">Cancelado</span>`; break;
                case 'denegado': statusBadge = `<span class="text-xs font-semibold bg-red-200 text-red-800 px-2 py-1 rounded-full">Denegado</span>`; break;
            }
            el.innerHTML = `
                <div>
                    <p class="font-bold">${formatCurrency(p.amount)}</p>
                    <p class="text-xs text-gray-500">${p.requestDate}</p>
                </div>
                ${statusBadge}
            `;
            loansListEl.appendChild(el);
        });
    });
}

function showRRHHModal(empleado) {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    modalContentWrapper.innerHTML = `
        <div class="bg-white rounded-lg shadow-xl w-full max-w-5xl mx-auto text-left flex flex-col" style="max-height: 90vh;">
            <div class="flex justify-between items-center p-4 border-b">
                <h2 class="text-xl font-semibold">Recursos Humanos: ${empleado.nombre}</h2>
                <button id="close-rrhh-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
            </div>
            <div class="border-b border-gray-200">
                <nav id="rrhh-nav" class="-mb-px flex space-x-6 px-6">
                    <button data-tab="contratacion" class="rrhh-tab-btn active py-3 px-1 font-semibold">Datos y Contratación</button>
                    <button data-tab="pagos" class="rrhh-tab-btn py-3 px-1 font-semibold">Pagos y Liquidaciones</button>
                    <button data-tab="descargos" class="rrhh-tab-btn py-3 px-1 font-semibold">Descargos</button>
                    <button data-tab="prestamos" class="rrhh-tab-btn py-3 px-1 font-semibold">Préstamos</button>
                </nav>
            </div>
            <div id="rrhh-content" class="p-6 overflow-y-auto flex-grow">
                <!-- Content will be rendered here -->
            </div>
        </div>
    `;
    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('close-rrhh-modal').addEventListener('click', hideModal);

    const rrhhContent = document.getElementById('rrhh-content');
    renderContratacionTab(empleado, rrhhContent); // Carga la primera pestaña por defecto

    document.querySelectorAll('.rrhh-tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.rrhh-tab-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            const tab = e.target.dataset.tab;
            
            switch(tab) {
                case 'contratacion': renderContratacionTab(empleado, rrhhContent); break;
                case 'pagos': renderPagosTab(empleado, rrhhContent); break;
                case 'descargos': renderDescargosTab(empleado, rrhhContent); break;
                case 'prestamos': renderPrestamosTab(empleado, rrhhContent); break;
            }
        });
    });
}

function showAdminEditUserModal(user) {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    const userPermissions = user.permissions || {};
    const ALL_MODULES = ['remisiones', 'facturacion', 'clientes', 'items', 'colores', 'gastos', 'proveedores'];

    let permissionsHTML = ALL_MODULES.map(module => {
        const isChecked = userPermissions[module] || false;
        const capitalized = module.charAt(0).toUpperCase() + module.slice(1);
        return `
            <label class="flex items-center space-x-2">
                <input type="checkbox" class="permission-checkbox h-4 w-4 rounded border-gray-300" data-module="${module}" ${isChecked ? 'checked' : ''}>
                <span>${capitalized}</span>
            </label>
        `;
    }).join('');

    modalContentWrapper.innerHTML = `
        <div class="bg-white rounded-lg p-6 shadow-xl max-w-lg w-full mx-auto text-left">
            <div class="flex justify-between items-center mb-4">
                <h2 class="text-xl font-semibold">Gestionar Empleado: ${user.nombre}</h2>
                <button id="close-admin-edit-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
            </div>
            <form id="admin-edit-user-form" class="space-y-4">
                <input type="hidden" id="admin-edit-user-id" value="${user.id}">
                <div><label class="block text-sm font-medium">Nombre Completo</label><input type="text" id="admin-edit-name" class="w-full p-2 border rounded-lg mt-1" value="${user.nombre || ''}" required></div>
                <div><label class="block text-sm font-medium">Correo Electrónico</label><input type="email" id="admin-edit-email" class="w-full p-2 border rounded-lg mt-1" value="${user.email || ''}" required></div>
                <div>
                    <label class="block text-sm font-medium">Rol</label>
                    <select id="admin-edit-role-select" class="w-full p-2 border rounded-lg mt-1 bg-white">
                        <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Administrador</option>
                        <option value="planta" ${user.role === 'planta' ? 'selected' : ''}>Planta</option>
                    </select>
                </div>
                <div id="admin-edit-permissions-container">
                    <label class="block text-sm font-medium mb-2">Permisos de Módulos</label>
                    <div class="grid grid-cols-2 gap-2">${permissionsHTML}</div>
                </div>
                <div class="flex justify-end pt-4">
                    <button type="submit" class="w-full bg-indigo-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-indigo-700">Guardar Cambios</button>
                </div>
            </form>
        </div>
    `;

    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('close-admin-edit-modal').addEventListener('click', hideModal);
    document.getElementById('admin-edit-user-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const userId = document.getElementById('admin-edit-user-id').value;
        const newRole = document.getElementById('admin-edit-role-select').value;
        const newPermissions = {};
        
        document.querySelectorAll('#admin-edit-permissions-container .permission-checkbox').forEach(cb => {
            newPermissions[cb.dataset.module] = cb.checked;
        });

        const updatedData = {
            nombre: document.getElementById('admin-edit-name').value,
            email: document.getElementById('admin-edit-email').value,
            role: newRole,
            permissions: (newRole === 'admin') ? {} : newPermissions
        };
        
        showModalMessage("Guardando cambios...", true);
        try {
            await updateDoc(doc(db, "users", userId), updatedData);
            hideModal();
            showModalMessage("Datos del empleado actualizados.", false, 2000);
        } catch (error) {
            console.error("Error al actualizar empleado:", error);
            showModalMessage("Error al guardar los cambios.");
        }
    });
}

function renderContratacionTab(empleado, container) {
    const contratacionData = empleado.contratacion || {};
    const documentos = contratacionData.documentos || {};

    let documentsHTML = RRHH_DOCUMENT_TYPES.map(docType => {
        const docUrl = documentos[docType.id];
        const fileInputId = `file-rrhh-${docType.id}-${empleado.id}`;
        return `
            <div class="flex justify-between items-center p-3 border-b">
                <span class="font-medium">${docType.name}</span>
                <div class="flex items-center gap-2">
                    ${docUrl ? `<a href="${docUrl}" target="_blank" class="bg-blue-500 text-white px-3 py-1 rounded-lg text-sm hover:bg-blue-600">Ver</a>` : '<span class="text-xs text-gray-400">No adjunto</span>'}
                    ${docUrl ? `<button type="button" data-doctype="${docType.id}" class="delete-rrhh-doc-btn bg-red-500 text-white px-3 py-1 rounded-lg text-sm hover:bg-red-600">Eliminar</button>` : ''}
                    <input type="file" id="${fileInputId}" data-doctype="${docType.id}" class="rrhh-file-input hidden" accept=".pdf,.jpg,.jpeg,.png">
                    <label for="${fileInputId}" class="bg-gray-200 text-gray-700 px-3 py-1 rounded-lg text-sm font-semibold cursor-pointer hover:bg-gray-300">Adjuntar</label>
                </div>
            </div>
        `;
    }).join('');

    container.innerHTML = `
        <form id="contratacion-form">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div class="space-y-4">
                    <h3 class="text-lg font-semibold border-b pb-2">Información Laboral</h3>
                    <div><label class="block text-sm font-medium">Fecha de Ingreso</label><input type="date" id="rrhh-fechaIngreso" class="w-full p-2 border rounded-lg mt-1" value="${contratacionData.fechaIngreso || ''}"></div>
                    <div><label class="block text-sm font-medium">Salario</label><input type="text" id="rrhh-salario" class="w-full p-2 border rounded-lg mt-1" value="${contratacionData.salario ? formatCurrency(contratacionData.salario) : ''}"></div>
                    <div><label class="block text-sm font-medium">EPS</label><input type="text" id="rrhh-eps" class="w-full p-2 border rounded-lg mt-1" value="${contratacionData.eps || ''}"></div>
                    <div><label class="block text-sm font-medium">AFP</label><input type="text" id="rrhh-afp" class="w-full p-2 border rounded-lg mt-1" value="${contratacionData.afp || ''}"></div>
                    <h3 class="text-lg font-semibold border-b pb-2 pt-4">Gestión de Retiro</h3>
                    <div><label class="block text-sm font-medium">Fecha de Retiro</label><input type="date" id="rrhh-fechaRetiro" class="w-full p-2 border rounded-lg mt-1" value="${contratacionData.fechaRetiro || ''}"></div>
                    <div><label class="block text-sm font-medium">Motivo de Retiro</label><textarea id="rrhh-motivoRetiro" class="w-full p-2 border rounded-lg mt-1" rows="2">${contratacionData.motivoRetiro || ''}</textarea></div>
                </div>
                <div class="space-y-4">
                    <h3 class="text-lg font-semibold border-b pb-2">Documentos</h3>
                    <div class="border rounded-lg">${documentsHTML}</div>
                    <button type="button" id="download-all-docs-btn" class="w-full bg-green-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-green-700">Descargar Todo (.zip)</button>
                </div>
            </div>
            <div class="flex justify-end mt-6">
                <button type="submit" class="bg-indigo-600 text-white font-bold py-2 px-6 rounded-lg hover:bg-indigo-700">Guardar Información</button>
            </div>
        </form>
    `;
    attachRRHHFormListeners(empleado);
}

function renderPagosTab(empleado, container) {
    container.innerHTML = `<div>Pagos y Liquidaciones para ${empleado.nombre}</div>`;
}

function renderDescargosTab(empleado, container) {
    container.innerHTML = `<div>Descargos para ${empleado.nombre}</div>`;
}

function renderPrestamosTab(empleado, container) {
    container.innerHTML = `<div>Préstamos para ${empleado.nombre}</div>`;
}

function attachRRHHFormListeners(empleado) {
    const salarioInput = document.getElementById('rrhh-salario');
    salarioInput.addEventListener('input', autoFormatCurrency);

    document.getElementById('contratacion-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const updatedData = {
            "contratacion.fechaIngreso": document.getElementById('rrhh-fechaIngreso').value,
            "contratacion.salario": unformatCurrency(salarioInput.value),
            "contratacion.eps": document.getElementById('rrhh-eps').value,
            "contratacion.afp": document.getElementById('rrhh-afp').value,
            "contratacion.fechaRetiro": document.getElementById('rrhh-fechaRetiro').value,
            "contratacion.motivoRetiro": document.getElementById('rrhh-motivoRetiro').value,
        };
        showModalMessage("Guardando información...", true);
        try {
            await updateDoc(doc(db, "users", empleado.id), updatedData);
            hideModal();
            showModalMessage("Información guardada.", false, 2000);
        } catch (error) {
            console.error("Error al guardar información de RRHH:", error);
            showModalMessage("Error al guardar.");
        }
    });

    document.querySelectorAll('.rrhh-file-input').forEach(input => {
        input.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            const docType = e.target.dataset.doctype;
            if (!file || !docType) return;

            showModalMessage(`Subiendo ${docType}...`, true);
            try {
                const storageRef = ref(storage, `rrhh/${empleado.id}/${docType}-${file.name}`);
                const snapshot = await uploadBytes(storageRef, file);
                const downloadURL = await getDownloadURL(snapshot.ref);

                const updateKey = `contratacion.documentos.${docType}`;
                await updateDoc(doc(db, "users", empleado.id), {
                    [updateKey]: downloadURL
                });

                const updatedUserDoc = await getDoc(doc(db, "users", empleado.id));
                const updatedEmpleado = { id: updatedUserDoc.id, ...updatedUserDoc.data() };

                renderContratacionTab(updatedEmpleado, document.getElementById('rrhh-content'));
                hideModal(); // Cierra el modal de "Subiendo..."
            } catch (error) {
                console.error("Error al subir documento:", error);
                showModalMessage("Error al subir el archivo.");
            }
        });
    });

    document.querySelectorAll('.delete-rrhh-doc-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const docType = e.target.dataset.doctype;
            handleDeleteRRHHFile(empleado, docType);
        });
    });

    document.getElementById('download-all-docs-btn').addEventListener('click', () => handleDownloadAllDocs(empleado));
}

async function handleDeleteRRHHFile(empleado, docType) {
    if (!confirm(`¿Estás seguro de que quieres eliminar el documento "${docType}" para ${empleado.nombre}?`)) {
        return;
    }

    showModalMessage("Eliminando documento...", true);
    try {
        const fileUrl = empleado.contratacion?.documentos?.[docType];

        // Delete from Storage first
        if (fileUrl) {
            const fileRef = ref(storage, fileUrl);
            await deleteObject(fileRef).catch(error => {
                if (error.code !== 'storage/object-not-found') {
                    throw error;
                }
            });
        }

        // Delete from Firestore
        const updateKey = `contratacion.documentos.${docType}`;
        await updateDoc(doc(db, "users", empleado.id), {
            [updateKey]: null
        });

        const updatedUserDoc = await getDoc(doc(db, "users", empleado.id));
        const updatedEmpleado = { id: updatedUserDoc.id, ...updatedUserDoc.data() };
        
        renderContratacionTab(updatedEmpleado, document.getElementById('rrhh-content'));
        hideModal();
        showModalMessage("Documento eliminado.", false, 2000);

    } catch (error) {
        console.error("Error al eliminar documento:", error);
        hideModal();
        showModalMessage("Error al eliminar el documento.");
    }
}

async function handleDownloadAllDocs(empleado) {
    const documentos = empleado.contratacion?.documentos;
    if (!documentos || Object.keys(documentos).length === 0) {
        showModalMessage("No hay documentos para descargar.");
        return;
    }

    showModalMessage("Preparando descarga...", true);
    const zip = new JSZip();
    const promises = [];

    for (const docType in documentos) {
        const url = documentos[docType];
        if (url) {
            const promise = fetch(url)
                .then(response => response.blob())
                .then(blob => {
                    const fileName = `${docType}.${blob.type.split('/')[1]}`;
                    zip.file(fileName, blob);
                })
                .catch(err => console.error(`Error fetching ${docType}:`, err));
            promises.push(promise);
        }
    }

    await Promise.all(promises);

    zip.generateAsync({ type: "blob" })
        .then(content => {
            const link = document.createElement('a');
            link.href = URL.createObjectURL(content);
            link.download = `documentos_${empleado.nombre.replace(/\s/g, '_')}.zip`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            hideModal();
        });
}

async function handleLoanRequestSubmit(e) {
    e.preventDefault();
    const amount = unformatCurrency(document.getElementById('loan-amount').value);
    const reason = document.getElementById('loan-reason').value;

    if (amount <= 0) {
        showModalMessage("El monto debe ser mayor a cero.");
        return;
    }

    const newLoan = {
        employeeId: currentUser.uid,
        employeeName: currentUserData.nombre,
        amount: amount,
        reason: reason,
        requestDate: new Date().toISOString().split('T')[0],
        status: 'solicitado'
    };

    showModalMessage("Enviando solicitud...", true);
    try {
        await addDoc(collection(db, "prestamos"), newLoan);
        hideModal();
        showModalMessage("¡Solicitud enviada con éxito!", false, 2000);
    } catch (error) {
        console.error("Error al solicitar préstamo:", error);
        showModalMessage("Error al enviar la solicitud.");
    }
}

function updateDashboard() {
    const salesThisMonth = allRemisiones.flatMap(r => r.payments || []).filter(p => { const d = new Date(p.date); return d.getMonth() === new Date().getMonth() && d.getFullYear() === new Date().getFullYear(); }).reduce((sum, p) => sum + p.amount, 0);
    const expensesThisMonth = allGastos.filter(g => { const d = new Date(g.fecha); return d.getMonth() === new Date().getMonth() && d.getFullYear() === new Date().getFullYear(); }).reduce((sum, g) => sum + g.valorTotal, 0);
    const profitThisMonth = salesThisMonth - expensesThisMonth;
    const totalCartera = allRemisiones.filter(r => r.estado !== 'Anulada').reduce((sum, r) => { const totalPagado = (r.payments || []).reduce((s, p) => s + p.amount, 0); const saldo = r.valorTotal - totalPagado; return sum + (saldo > 0 ? saldo : 0); }, 0);

    document.getElementById('summary-sales').textContent = formatCurrency(salesThisMonth);
    document.getElementById('summary-expenses').textContent = formatCurrency(expensesThisMonth);
    document.getElementById('summary-profit').textContent = formatCurrency(profitThisMonth);
    document.getElementById('summary-cartera').textContent = formatCurrency(totalCartera);

    const monthNames = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
    const labels = [];
    const salesData = [];
    const expensesData = [];
    for (let i = 5; i >= 0; i--) {
        const d = new Date();
        d.setMonth(d.getMonth() - i);
        const m = d.getMonth();
        const y = d.getFullYear();
        labels.push(monthNames[m]);
        const monthlySales = allRemisiones.flatMap(r => r.payments || []).filter(p => { const pDate = new Date(p.date); return pDate.getMonth() === m && pDate.getFullYear() === y; }).reduce((sum, p) => sum + p.amount, 0);
        const monthlyExpenses = allGastos.filter(g => { const gDate = new Date(g.fecha); return gDate.getMonth() === m && gDate.getFullYear() === y; }).reduce((sum, g) => sum + g.valorTotal, 0);
        salesData.push(monthlySales);
        expensesData.push(monthlyExpenses);
    }
    const ctx = document.getElementById('profitLossChart').getContext('2d');
    if (profitLossChart) {
        profitLossChart.destroy();
    }
    profitLossChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: 'Ventas', data: salesData, backgroundColor: 'rgba(75, 192, 192, 0.6)' },
                { label: 'Gastos', data: expensesData, backgroundColor: 'rgba(255, 99, 132, 0.6)' }
            ]
        },
        options: { scales: { y: { beginAtZero: true } } }
    });
}
