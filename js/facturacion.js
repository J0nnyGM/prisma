import { db, storage } from './firebase-config.js';
import { doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { allRemisiones } from './main.js';
import { showModalMessage, hideModal, formatCurrency, showPdfModal } from './ui.js';

export function setupFacturacionEventListeners() {
    const pendientesTab = document.getElementById('tab-pendientes');
    const realizadasTab = document.getElementById('tab-realizadas');
    const pendientesView = document.getElementById('view-pendientes');
    const realizadasView = document.getElementById('view-realizadas');

    if (pendientesTab) {
        pendientesTab.addEventListener('click', () => {
            pendientesTab.classList.add('active');
            realizadasTab.classList.remove('active');
            pendientesView.classList.remove('hidden');
            realizadasView.classList.add('hidden');
        });
    }
    if (realizadasTab) {
        realizadasTab.addEventListener('click', () => {
            realizadasTab.classList.add('active');
            pendientesTab.classList.remove('active');
            realizadasView.classList.remove('hidden');
            pendientesView.classList.add('hidden');
        });
    }
}

export function loadFacturacion() {
    renderFacturacion();
}

export function renderFacturacion() {
    const pendientesListEl = document.getElementById('facturacion-pendientes-list');
    const realizadasListEl = document.getElementById('facturacion-realizadas-list');
    if (!pendientesListEl || !realizadasListEl) return;

    const remisionesParaFacturar = allRemisiones.filter(r => r.incluyeIVA && r.estado !== 'Anulada');
    
    const pendientes = remisionesParaFacturar.filter(r => !r.facturado);
    const realizadas = remisionesParaFacturar.filter(r => r.facturado);

    pendientesListEl.innerHTML = '';
    if (pendientes.length === 0) {
        pendientesListEl.innerHTML = '<p class="text-center text-gray-500 py-8">No hay remisiones pendientes de facturar.</p>';
    } else {
        pendientes.forEach(remision => {
            const el = document.createElement('div');
            el.className = 'border p-4 rounded-lg flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4';
            el.innerHTML = `
                <div class="flex-grow">
                    <div class="flex items-center gap-3 flex-wrap">
                        <span class="remision-id">N° ${remision.numeroRemision}</span>
                        <p class="font-semibold text-lg">${remision.clienteNombre}</p>
                    </div>
                    <p class="text-sm text-gray-600 mt-1">Fecha: ${remision.fechaRecibido} &bull; Total: <span class="font-bold">${formatCurrency(remision.valorTotal)}</span></p>
                </div>
                <div class="flex-shrink-0 flex items-center gap-2">
                    <button data-pdf-url="${remision.pdfUrl}" data-remision-num="${remision.numeroRemision}" class="view-pdf-btn bg-gray-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-gray-600">Ver Remisión</button>
                    <button data-remision-id="${remision.id}" class="facturar-btn bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700">Facturar</button>
                </div>
            `;
            pendientesListEl.appendChild(el);
        });
    }

    realizadasListEl.innerHTML = '';
    if (realizadas.length === 0) {
        realizadasListEl.innerHTML = '<p class="text-center text-gray-500 py-8">No hay remisiones facturadas.</p>';
    } else {
        realizadas.forEach(remision => {
            const el = document.createElement('div');
            el.className = 'border p-4 rounded-lg flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4';
            
            let facturaButtons = '';
            if (remision.facturaPdfUrl) {
                facturaButtons = `<button data-pdf-url="${remision.facturaPdfUrl}" data-remision-num="${remision.numeroFactura || remision.numeroRemision}" class="view-factura-pdf-btn bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-green-700">Ver Factura</button>`;
            } else {
                facturaButtons = `<button data-remision-id="${remision.id}" class="facturar-btn bg-orange-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-orange-600">Adjuntar Factura</button>`;
            }

            el.innerHTML = `
                <div class="flex-grow">
                    <div class="flex items-center gap-3 flex-wrap">
                        <span class="remision-id">N° ${remision.numeroRemision}</span>
                        <p class="font-semibold text-lg">${remision.clienteNombre}</p>
                    </div>
                    <p class="text-sm text-gray-600 mt-1">Fecha: ${remision.fechaRecibido} &bull; Total: <span class="font-bold">${formatCurrency(remision.valorTotal)}</span></p>
                </div>
                <div class="flex-shrink-0 flex items-center gap-2">
                     <div class="text-right">
                        <span class="status-badge status-entregado">Facturado</span>
                        ${remision.numeroFactura ? `<p class="text-sm text-gray-600 mt-1">Factura N°: <span class="font-semibold">${remision.numeroFactura}</span></p>` : ''}
                    </div>
                    ${facturaButtons}
                    <button data-pdf-url="${remision.pdfUrl}" data-remision-num="${remision.numeroRemision}" class="view-pdf-btn bg-gray-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-gray-600">Ver Remisión</button>
                </div>
            `;
            realizadasListEl.appendChild(el);
        });
    }

    document.querySelectorAll('.facturar-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const remisionId = e.currentTarget.dataset.remisionId;
            showFacturaModal(remisionId);
        });
    });
    document.querySelectorAll('.view-pdf-btn').forEach(button => button.addEventListener('click', (e) => { const pdfUrl = e.currentTarget.dataset.pdfUrl; const remisionNum = e.currentTarget.dataset.remisionNum; showPdfModal(pdfUrl, `Remisión N° ${remisionNum}`); }));
    document.querySelectorAll('.view-factura-pdf-btn').forEach(button => button.addEventListener('click', (e) => { const pdfUrl = e.currentTarget.dataset.pdfUrl; const remisionNum = e.currentTarget.dataset.remisionNum; showPdfModal(pdfUrl, `Factura N° ${remisionNum}`); }));
}

function showFacturaModal(remisionId) {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    modalContentWrapper.innerHTML = `
        <div class="bg-white rounded-lg p-6 shadow-xl max-w-md w-full mx-auto text-left">
            <div class="flex justify-between items-center mb-4">
                <h2 class="text-xl font-semibold">Registrar Factura</h2>
                <button id="close-factura-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
            </div>
            <form id="factura-form" class="space-y-4">
                <div>
                    <label for="factura-numero" class="block text-sm font-medium">Número de Factura</label>
                    <input type="text" id="factura-numero" class="w-full p-2 border rounded-lg mt-1" required>
                </div>
                <div>
                    <label for="factura-pdf" class="block text-sm font-medium">Adjuntar PDF de la Factura</label>
                    <input type="file" id="factura-pdf" class="w-full p-2 border rounded-lg mt-1" accept=".pdf" required>
                </div>
                <button type="submit" class="w-full bg-blue-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-blue-700">Marcar como Facturado</button>
            </form>
        </div>
    `;
    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('close-factura-modal').addEventListener('click', hideModal);
    document.getElementById('factura-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const numeroFactura = document.getElementById('factura-numero').value;
        const fileInput = document.getElementById('factura-pdf');
        const file = fileInput.files[0];

        if (!file) {
            showModalMessage("Debes seleccionar un archivo PDF.");
            return;
        }

        showModalMessage("Subiendo factura y actualizando...", true);
        try {
            const storageRef = ref(storage, `facturas/${remisionId}-${file.name}`);
            const snapshot = await uploadBytes(storageRef, file);
            const downloadURL = await getDownloadURL(snapshot.ref);

            await updateDoc(doc(db, "remisiones", remisionId), {
                facturado: true,
                numeroFactura: numeroFactura,
                facturaPdfUrl: downloadURL,
                fechaFacturado: new Date()
            });

            hideModal();
            showModalMessage("¡Remisión facturada con éxito!", false, 2000);
        } catch (error) {
            console.error("Error al facturar:", error);
            showModalMessage("Error al procesar la factura.");
        }
    });
}
