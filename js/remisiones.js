import { db } from './firebase-config.js';
import { collection, query, orderBy, onSnapshot, doc, updateDoc, runTransaction, addDoc, arrayUnion } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { setAllRemisiones, allRemisiones, currentUser, currentUserData, allClientes, allItems, allColores } from './main.js';
import { showModalMessage, hideModal, formatCurrency, unformatCurrency, showPdfModal, initSearchableInput, autoFormatCurrency } from './ui.js';
import { renderFacturacion } from './facturacion.js';
import { renderClientes } from './clientes.js';

const ESTADOS_REMISION = ['Recibido', 'En Proceso', 'Procesado', 'Entregado'];
let dynamicElementCounter = 0;

export function setupRemisionesEventListeners() {
    document.getElementById('remision-form').addEventListener('submit', handleRemisionSubmit);
    document.getElementById('add-item-btn').addEventListener('click', () => {
        const itemsContainer = document.getElementById('items-container');
        if (itemsContainer) itemsContainer.appendChild(createItemElement());
    });
    document.getElementById('incluir-iva').addEventListener('input', calcularTotales);
    document.getElementById('search-remisiones').addEventListener('input', renderRemisiones);
    document.getElementById('filter-remisiones-month').addEventListener('change', renderRemisiones);
    document.getElementById('filter-remisiones-year').addEventListener('change', renderRemisiones);
    document.getElementById('fecha-recibido').value = new Date().toISOString().split('T')[0];
    
    // Setup initial item row
    const itemsContainer = document.getElementById('items-container');
    if (itemsContainer.children.length === 0) {
        itemsContainer.appendChild(createItemElement());
    }

    // Setup client search
    const clienteSearchInput = document.getElementById('cliente-search-input');
    const clienteSearchResults = document.getElementById('cliente-search-results');
    const clienteIdHidden = document.getElementById('cliente-id-hidden');
    initSearchableInput(clienteSearchInput, clienteSearchResults, () => allClientes, (cliente) => cliente.nombre, (selectedCliente) => {
        clienteIdHidden.value = selectedCliente ? selectedCliente.id : '';
    });
}

export function loadRemisiones() {
    const q = query(collection(db, "remisiones"), orderBy("numeroRemision", "desc"));
    onSnapshot(q, (snapshot) => {
        const remisiones = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setAllRemisiones(remisiones);
        renderRemisiones();
    });
}

function renderRemisiones() {
    const remisionesListEl = document.getElementById('remisiones-list');
    if(!remisionesListEl) return;

    // These functions depend on remisiones data, so they are called here
    renderFacturacion();
    renderClientes();

    const isPlanta = currentUserData && currentUserData.role === 'planta';
    const month = document.getElementById('filter-remisiones-month').value;
    const year = document.getElementById('filter-remisiones-year').value;
    const searchTerm = document.getElementById('search-remisiones').value.toLowerCase();

    let filtered = allRemisiones;

    if (isPlanta) {
        const allowedStates = ['Recibido', 'En Proceso', 'Procesado'];
        filtered = filtered.filter(r => allowedStates.includes(r.estado));
    }

    if (year !== 'all') {
        filtered = filtered.filter(r => new Date(r.fechaRecibido).getFullYear() == year);
    }
    if (month !== 'all') {
        filtered = filtered.filter(r => new Date(r.fechaRecibido).getMonth() == month);
    }
    if (searchTerm) {
        filtered = filtered.filter(r => r.clienteNombre.toLowerCase().includes(searchTerm) || r.numeroRemision.toString().includes(searchTerm));
    }

    remisionesListEl.innerHTML = '';
    if (filtered.length === 0) { remisionesListEl.innerHTML = '<p class="text-center text-gray-500 py-8">No se encontraron remisiones.</p>'; return; }
    
    filtered.forEach((remision) => {
        const el = document.createElement('div');
        const esAnulada = remision.estado === 'Anulada';
        const esEntregada = remision.estado === 'Entregado';
        el.className = `border p-4 rounded-lg flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 ${esAnulada ? 'remision-anulada' : ''}`;
        
        const totalPagadoConfirmado = (remision.payments || []).filter(p => p.status === 'confirmado').reduce((sum, p) => sum + p.amount, 0);
        const saldoPendiente = remision.valorTotal - totalPagadoConfirmado;
        
        let paymentStatusBadge = '';
        if (!esAnulada) {
            if (saldoPendiente <= 0) {
                paymentStatusBadge = `<span class="payment-status payment-pagado">Pagado</span>`;
            } else if (totalPagadoConfirmado > 0) {
                paymentStatusBadge = `<span class="payment-status payment-abono">Abono</span>`;
            } else {
                paymentStatusBadge = `<span class="payment-status payment-pendiente">Pendiente</span>`;
            }
        }

        const pdfUrl = isPlanta ? remision.pdfPlantaUrl : remision.pdfUrl;
        const pdfButton = pdfUrl ? `<button data-pdf-url="${pdfUrl}" data-remision-num="${remision.numeroRemision}" class="view-pdf-btn w-full bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-green-700 transition text-center">Ver Remisión</button>` : `<button class="w-full bg-gray-400 text-white px-4 py-2 rounded-lg text-sm font-semibold btn-disabled">Generando PDF...</button>`;
        
        const anularButton = (esAnulada || esEntregada || isPlanta || (remision.payments && remision.payments.length > 0)) 
            ? '' 
            : `<button data-remision-id="${remision.id}" class="anular-btn w-full bg-yellow-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-yellow-600 transition">Anular</button>`;
        
        const pagosButton = esAnulada || isPlanta ? '' : `<button data-remision-json='${JSON.stringify(remision)}' class="payment-btn w-full bg-purple-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-purple-700 transition">Pagos (${formatCurrency(saldoPendiente)})</button>`;
        
        const descuentoButton = (esAnulada || esEntregada || isPlanta || remision.discount) 
            ? '' 
            : `<button data-remision-json='${JSON.stringify(remision)}' class="discount-btn w-full bg-cyan-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-cyan-600 transition">Descuento</button>`;

        const statusClasses = {'Recibido': 'status-recibido', 'En Proceso': 'status-en-proceso', 'Procesado': 'status-procesado', 'Entregado': 'status-entregado'};
        const statusBadge = `<span class="status-badge ${statusClasses[remision.estado] || ''}">${remision.estado}</span>`;

        let statusButton = '';
        const currentIndex = ESTADOS_REMISION.indexOf(remision.estado);
        if (!esAnulada && currentIndex < ESTADOS_REMISION.length - 1) {
            const nextStatus = ESTADOS_REMISION[currentIndex + 1];
            statusButton = `<button data-remision-id="${remision.id}" data-current-status="${remision.estado}" class="status-update-btn w-full bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-600 transition">Mover a ${nextStatus}</button>`;
        }
        
        let discountInfo = '';
        if(remision.discount && remision.discount.percentage > 0) {
            discountInfo = `<span class="text-xs font-semibold bg-cyan-100 text-cyan-800 px-2 py-1 rounded-full">DTO ${remision.discount.percentage.toFixed(2)}%</span>`;
        }

        el.innerHTML = `
            <div class="flex-grow">
                <div class="flex items-center gap-3 flex-wrap">
                    <span class="remision-id">N° ${remision.numeroRemision}</span>
                    <p class="font-semibold text-lg">${remision.clienteNombre}</p>
                    ${statusBadge}
                    ${paymentStatusBadge}
                    ${discountInfo}
                    ${esAnulada ? '<span class="px-2 py-1 bg-red-200 text-red-800 text-xs font-bold rounded-full">ANULADA</span>' : ''}
                </div>
                <p class="text-sm text-gray-600 mt-1">Recibido: ${remision.fechaRecibido} &bull; ${remision.fechaEntrega ? `Entregado: ${remision.fechaEntrega}` : 'Entrega: Pendiente'}</p>
                ${!isPlanta ? `<p class="text-sm text-gray-600 mt-1">Total: <span class="font-bold">${formatCurrency(remision.valorTotal)}</span></p>` : ''}
            </div>
            <div class="grid grid-cols-2 gap-2 flex-shrink-0 w-full sm:max-w-xs">
                ${statusButton}
                ${pdfButton}
                ${pagosButton}
                ${descuentoButton}
                ${anularButton}
            </div>`;
        remisionesListEl.appendChild(el);
    });

    document.querySelectorAll('.anular-btn').forEach(button => button.addEventListener('click', (e) => { const remisionId = e.currentTarget.dataset.remisionId; if(confirm(`¿Estás seguro de que quieres ANULAR esta remisión? Se enviará un correo de notificación al cliente.`)) { handleAnularRemision(remisionId); } }));
    document.querySelectorAll('.status-update-btn').forEach(button => button.addEventListener('click', (e) => { const remisionId = e.currentTarget.dataset.remisionId; const currentStatus = e.currentTarget.dataset.currentStatus; handleStatusUpdate(remisionId, currentStatus); }));
    document.querySelectorAll('.view-pdf-btn').forEach(button => button.addEventListener('click', (e) => { const pdfUrl = e.currentTarget.dataset.pdfUrl; const remisionNum = e.currentTarget.dataset.remisionNum; showPdfModal(pdfUrl, `Remisión N° ${remisionNum}`); }));
    document.querySelectorAll('.payment-btn').forEach(button => button.addEventListener('click', (e) => { const remision = JSON.parse(e.currentTarget.dataset.remisionJson); showPaymentModal(remision); }));
    document.querySelectorAll('.discount-btn').forEach(button => button.addEventListener('click', (e) => { const remision = JSON.parse(e.currentTarget.dataset.remisionJson); showDiscountModal(remision); }));
}

async function handleRemisionSubmit(e) {
    e.preventDefault();
    const clienteId = document.getElementById('cliente-id-hidden').value;
    const clienteNombre = document.getElementById('cliente-search-input').value;
    const cliente = allClientes.find(c => c.id === clienteId);
    const itemsContainer = document.getElementById('items-container');

    if (!currentUser || !clienteId || !cliente) {
        showModalMessage("Debes seleccionar un cliente válido de la lista.");
        return;
    }
    if (itemsContainer.children.length === 0) {
        showModalMessage("Debes añadir al menos un ítem.");
        return;
    }
    showModalMessage("Guardando remisión...", true);
    const counterRef = doc(db, "counters", "remisionCounter");
    try {
        const newRemisionNumber = await runTransaction(db, async (transaction) => {
            const counterDoc = await transaction.get(counterRef);
            if (!counterDoc.exists()) {
                transaction.set(counterRef, { currentNumber: 1 });
                return 1;
            }
            const newNumber = counterDoc.data().currentNumber + 1;
            transaction.update(counterRef, { currentNumber: newNumber });
            return newNumber;
        });
        const { subtotalGeneral, valorIVA, total } = calcularTotales();
        const items = Array.from(itemsContainer.querySelectorAll('.item-row')).map(row => ({
            itemId: row.querySelector('.item-id-hidden').value,
            referencia: row.querySelector('.item-id-hidden').dataset.ref,
            descripcion: row.querySelector('.item-id-hidden').dataset.desc,
            color: row.querySelector('.color-name-hidden').value,
            cantidad: parseFloat(row.querySelector('.item-cantidad').value) || 0,
            valorUnitario: unformatCurrency(row.querySelector('.item-valor-unitario').value) || 0,
        }));
        const formaDePago = document.getElementById('forma-pago').value;
        const initialPayments = [];
        if (formaDePago !== 'Pendiente') {
            initialPayments.push({ amount: total, date: document.getElementById('fecha-recibido').value, method: formaDePago, registeredAt: new Date(), registeredBy: currentUser.uid, status: 'confirmado' });
        }
        const nuevaRemision = {
            numeroRemision: newRemisionNumber,
            idCliente: clienteId,
            clienteNombre: clienteNombre,
            clienteEmail: cliente.email,
            fechaRecibido: document.getElementById('fecha-recibido').value,
            fechaEntrega: null,
            formaPago: formaDePago,
            incluyeIVA: document.getElementById('incluir-iva').checked,
            items: items,
            subtotal: subtotalGeneral,
            valorIVA: valorIVA,
            valorTotal: total,
            creadoPor: currentUser.uid,
            timestamp: new Date(),
            pdfUrl: null,
            emailStatus: 'pending',
            estado: 'Recibido',
            payments: initialPayments,
            facturado: false,
            numeroFactura: null
        };
        await addDoc(collection(db, "remisiones"), nuevaRemision);
        e.target.reset();
        document.getElementById('cliente-search-input').value = '';
        document.getElementById('cliente-id-hidden').value = '';
        itemsContainer.innerHTML = '';
        itemsContainer.appendChild(createItemElement());
        calcularTotales();
        hideModal();
        showModalMessage("¡Remisión guardada! Se está procesando el correo.", false, 3000);
        document.getElementById('fecha-recibido').value = new Date().toISOString().split('T')[0];
    } catch (error) {
        console.error("Error en la transacción o al crear la remisión: ", error);
        hideModal();
        showModalMessage("Error al generar el número de remisión.");
    }
}

async function handleStatusUpdate(remisionId, currentStatus) {
    const currentIndex = ESTADOS_REMISION.indexOf(currentStatus);
    if (currentIndex < ESTADOS_REMISION.length - 1) {
        const nextStatus = ESTADOS_REMISION[currentIndex + 1];
        const updateData = { estado: nextStatus };
        if (nextStatus === 'Entregado') {
            updateData.fechaEntrega = new Date().toISOString().split('T')[0];
        }
        showModalMessage("Actualizando estado...", true);
        try {
            await updateDoc(doc(db, "remisiones", remisionId), updateData);
            hideModal();
        } catch (error) {
            console.error("Error al actualizar estado:", error);
            showModalMessage("Error al actualizar estado.");
        }
    }
}

async function handleAnularRemision(remisionId) {
    showModalMessage("Anulando remisión...", true);
    try {
        const remisionRef = doc(db, "remisiones", remisionId);
        await updateDoc(remisionRef, { estado: "Anulada" });
        hideModal();
        showModalMessage("¡Remisión anulada con éxito!", false, 2000);
    } catch (error) {
        console.error("Error al anular la remisión:", error);
        hideModal();
        showModalMessage("Error al anular la remisión.");
    }
}

function createItemElement() {
    dynamicElementCounter++;
    const itemRow = document.createElement('div');
    itemRow.className = 'item-row grid grid-cols-1 gap-2';
    itemRow.dataset.id = dynamicElementCounter;

    itemRow.innerHTML = `
        <div class="relative">
            <input type="text" id="item-search-${dynamicElementCounter}" autocomplete="off" placeholder="Buscar ítem..." class="item-search-input w-full p-2 border border-gray-300 rounded-lg" required>
            <input type="hidden" class="item-id-hidden" name="itemId">
            <div id="item-results-${dynamicElementCounter}" class="search-results hidden"></div>
        </div>
        <div class="relative">
            <input type="text" id="color-search-${dynamicElementCounter}" autocomplete="off" placeholder="Buscar color..." class="color-search-input w-full p-2 border border-gray-300 rounded-lg" required>
            <input type="hidden" class="color-name-hidden" name="colorName">
            <div id="color-results-${dynamicElementCounter}" class="search-results hidden"></div>
        </div>
        <div class="grid grid-cols-3 gap-2">
            <input type="number" class="item-cantidad p-2 border border-gray-300 rounded-lg" placeholder="Cant." min="1" required>
            <input type="text" inputmode="numeric" class="item-valor-unitario p-2 border border-gray-300 rounded-lg" placeholder="Vlr. Unit." required>
            <button type="button" class="remove-item-btn bg-red-500 text-white font-bold rounded-lg hover:bg-red-600">Eliminar</button>
        </div>
    `;

    setTimeout(() => {
        const itemSearchInput = document.getElementById(`item-search-${dynamicElementCounter}`);
        const itemResultsContainer = document.getElementById(`item-results-${dynamicElementCounter}`);
        const itemIdHidden = itemRow.querySelector('.item-id-hidden');
        
        initSearchableInput(itemSearchInput, itemResultsContainer, () => allItems, (item) => `${item.referencia} - ${item.descripcion}`, (selectedItem) => {
            itemIdHidden.value = selectedItem ? selectedItem.id : '';
            itemIdHidden.dataset.ref = selectedItem ? selectedItem.referencia : '';
            itemIdHidden.dataset.desc = selectedItem ? selectedItem.descripcion : '';
        });

        const colorSearchInput = document.getElementById(`color-search-${dynamicElementCounter}`);
        const colorResultsContainer = document.getElementById(`color-results-${dynamicElementCounter}`);
        const colorNameHidden = itemRow.querySelector('.color-name-hidden');

        initSearchableInput(colorSearchInput, colorResultsContainer, () => allColores, (color) => color.nombre, (selectedColor) => {
            colorNameHidden.value = selectedColor ? selectedColor.nombre : '';
        });

        const valorUnitarioInput = itemRow.querySelector('.item-valor-unitario');
        valorUnitarioInput.addEventListener('input', autoFormatCurrency);

    }, 0);

    itemRow.querySelector('.remove-item-btn').addEventListener('click', () => { itemRow.remove(); calcularTotales(); });
    itemRow.querySelectorAll('input.item-cantidad, input.item-valor-unitario').forEach(input => input.addEventListener('input', calcularTotales));
    
    return itemRow;
}

function calcularTotales() {
    const itemsContainer = document.getElementById('items-container');
    const ivaCheckbox = document.getElementById('incluir-iva');
    const subtotalEl = document.getElementById('subtotal');
    const valorIvaEl = document.getElementById('valor-iva');
    const valorTotalEl = document.getElementById('valor-total');
    if(!itemsContainer || !ivaCheckbox || !subtotalEl || !valorIvaEl || !valorTotalEl) return {subtotalGeneral: 0, valorIVA: 0, total: 0};
    
    let subtotalGeneral = 0;
    itemsContainer.querySelectorAll('.item-row').forEach(row => {
        const cantidad = parseFloat(row.querySelector('.item-cantidad').value) || 0;
        const valorUnitario = unformatCurrency(row.querySelector('.item-valor-unitario').value);
        subtotalGeneral += cantidad * valorUnitario;
    });
    
    const incluyeIVA = ivaCheckbox.checked;
    const valorIVA = incluyeIVA ? subtotalGeneral * 0.19 : 0;
    const total = subtotalGeneral + valorIVA;
    
    subtotalEl.textContent = formatCurrency(subtotalGeneral);
    valorIvaEl.textContent = formatCurrency(valorIVA);
    valorTotalEl.textContent = formatCurrency(total);
    
    return { subtotalGeneral, valorIVA, total };
}

function showPaymentModal(remision) {
    const totalPagadoConfirmado = (remision.payments || []).filter(p => p.status === 'confirmado').reduce((sum, p) => sum + p.amount, 0);
    const totalAbonado = (remision.payments || []).reduce((sum, p) => sum + p.amount, 0);
    const saldoPendiente = remision.valorTotal - totalAbonado;

    let paymentsHTML = (remision.payments || []).map(p => {
        const canApprove = currentUserData.role === 'admin' && p.status === 'pendiente' && p.registeredBy !== currentUser.uid;
        return `
        <div class="flex justify-between items-center text-sm border-b py-2">
            <div>
                <p>${p.date} - ${p.method} - <span class="font-semibold">${formatCurrency(p.amount)}</span></p>
                <p class="text-xs text-gray-500">Registrado por: ${p.registeredByName || 'N/A'}</p>
            </div>
            <div class="flex items-center gap-2">
                <span class="text-xs font-semibold px-2 py-1 rounded-full ${p.status === 'confirmado' ? 'bg-green-200 text-green-800' : 'bg-yellow-200 text-yellow-800'}">${p.status}</span>
                ${canApprove ? `<button data-timestamp="${p.registeredAt.seconds}" class="approve-payment-btn bg-green-500 text-white px-2 py-1 text-xs rounded hover:bg-green-600">Aprobar</button>` : ''}
            </div>
        </div>
    `}).join('');
    if (!paymentsHTML) paymentsHTML = '<p class="text-center text-gray-500 text-sm py-4">No hay pagos registrados.</p>';

    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    modalContentWrapper.innerHTML = `
        <div class="bg-white rounded-lg p-6 shadow-xl max-w-2xl w-full mx-auto text-left">
            <div class="flex justify-between items-center mb-4">
                <h2 class="text-xl font-semibold">Gestionar Pagos (Remisión N° ${remision.numeroRemision})</h2>
                <button id="close-payment-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
            </div>
            <div class="grid md:grid-cols-2 gap-6">
                <div>
                    <h3 class="font-semibold mb-2">Registrar Nuevo Pago</h3>
                    <form id="add-payment-form" class="space-y-3 p-4 border rounded-lg">
                        <input type="text" id="payment-amount" inputmode="numeric" placeholder="Monto del abono" class="w-full p-2 border rounded-lg" required>
                        <input type="date" id="payment-date" class="w-full p-2 border rounded-lg" required>
                        <select id="payment-method" class="w-full p-2 border rounded-lg bg-white" required>
                            <option value="Efectivo">Efectivo</option>
                            <option value="Nequi">Nequi</option>
                            <option value="Davivienda">Davivienda</option>
                        </select>
                        <button type="submit" class="w-full bg-purple-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-purple-700">Añadir Pago</button>
                    </form>
                </div>
                <div class="bg-gray-50 p-4 rounded-lg">
                    <h3 class="font-semibold mb-2">Resumen</h3>
                    <div class="flex justify-between"><span class="font-medium">Total Remisión:</span><span>${formatCurrency(remision.valorTotal)}</span></div>
                    <div class="flex justify-between"><span class="font-medium">Total Pagado (Confirmado):</span><span>${formatCurrency(totalPagadoConfirmado)}</span></div>
                    <hr class="my-2">
                    <div class="flex justify-between text-lg font-bold"><span class="">Saldo Pendiente:</span><span class="text-red-600">${formatCurrency(saldoPendiente)}</span></div>
                </div>
            </div>
            <h3 class="font-semibold border-t pt-4 mt-6 mb-2">Historial de Pagos</h3>
            <div id="payments-history" class="space-y-1">${paymentsHTML}</div>
        </div>
    `;
    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('close-payment-modal').addEventListener('click', hideModal);
    
    document.getElementById('payment-date').value = new Date().toISOString().split('T')[0];
    const amountInput = document.getElementById('payment-amount');
    amountInput.addEventListener('input', autoFormatCurrency);

    document.getElementById('add-payment-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const amount = unformatCurrency(amountInput.value);
        if (isNaN(amount) || amount <= 0) {
            showModalMessage("El monto debe ser un número válido y mayor a cero.");
            return;
        }
        if (amount > saldoPendiente) {
            showModalMessage("El monto del pago no puede ser mayor al saldo pendiente.");
            return;
        }
        const newPayment = {
            amount: amount,
            date: document.getElementById('payment-date').value,
            method: document.getElementById('payment-method').value,
            registeredAt: new Date(),
            registeredBy: currentUser.uid,
            registeredByName: currentUserData.nombre,
            status: 'pendiente' // Pagos inician como pendientes
        };
        showModalMessage("Registrando pago...", true);
        try {
            await updateDoc(doc(db, "remisiones", remision.id), {
                payments: arrayUnion(newPayment)
            });
            hideModal();
            showModalMessage("¡Pago registrado! Pendiente de aprobación.", false, 2000);
        } catch (error) {
            console.error("Error al registrar el pago:", error);
            showModalMessage("Error al registrar el pago.");
        }
    });

    document.querySelectorAll('.approve-payment-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const timestamp = parseInt(e.target.dataset.timestamp, 10);
            handleApprovePayment(remision, timestamp);
        });
    });
}

async function handleApprovePayment(remision, timestamp) {
    const paymentIndex = remision.payments.findIndex(p => p.registeredAt.seconds === timestamp);
    if (paymentIndex === -1) {
        showModalMessage("Error: No se encontró el pago a aprobar.");
        return;
    }

    const updatedPayments = [...remision.payments];
    updatedPayments[paymentIndex].status = 'confirmado';
    updatedPayments[paymentIndex].approvedBy = currentUser.uid;
    updatedPayments[paymentIndex].approvedByName = currentUserData.nombre;
    updatedPayments[paymentIndex].approvedAt = new Date();

    showModalMessage("Aprobando pago...", true);
    try {
        await updateDoc(doc(db, "remisiones", remision.id), {
            payments: updatedPayments
        });
        hideModal();
        showModalMessage("¡Pago aprobado!", false, 2000);
    } catch (error) {
        console.error("Error al aprobar el pago:", error);
        showModalMessage("Error al aprobar el pago.");
    }
}

function showDiscountModal(remision) {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    modalContentWrapper.innerHTML = `
        <div class="bg-white rounded-lg p-6 shadow-xl max-w-md w-full mx-auto text-left">
            <div class="flex justify-between items-center mb-4">
                <h2 class="text-xl font-semibold">Aplicar Descuento</h2>
                <button id="close-discount-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
            </div>
            <form id="discount-form" class="space-y-4">
                <div class="p-4 border rounded-lg">
                    <div class="flex justify-between"><span>Total Original:</span><span class="font-bold">${formatCurrency(remision.valorTotal)}</span></div>
                    <div class="flex justify-between"><span>Descuento Máx. (5%):</span><span class="font-bold">${formatCurrency(remision.valorTotal * 0.05)}</span></div>
                </div>
                <div>
                    <label for="discount-amount" class="block text-sm font-medium">Valor del Descuento (en pesos)</label>
                    <input type="text" id="discount-amount" inputmode="numeric" class="w-full p-2 border rounded-lg mt-1" required>
                </div>
                <div class="bg-gray-50 p-4 rounded-lg">
                    <div class="flex justify-between"><span>Porcentaje Equivalente:</span><span id="discount-percentage-preview" class="font-bold"></span></div>
                    <div class="flex justify-between"><span>Nuevo Total:</span><span id="new-total-preview" class="font-bold"></span></div>
                </div>
                <button type="submit" class="w-full bg-cyan-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-cyan-700">Aplicar Descuento</button>
            </form>
        </div>
    `;
    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('close-discount-modal').addEventListener('click', hideModal);

    const amountInput = document.getElementById('discount-amount');
    const percentagePreview = document.getElementById('discount-percentage-preview');
    const newTotalPreview = document.getElementById('new-total-preview');
    const maxDiscount = remision.valorTotal * 0.05;

    amountInput.addEventListener('input', (e) => {
        autoFormatCurrency(e); // Format the input first

        let amount = unformatCurrency(amountInput.value);
        if (amount > maxDiscount) {
            amount = maxDiscount;
            amountInput.value = formatCurrency(amount);
        }
        
        const percentage = (amount / remision.valorTotal) * 100;
        const newTotal = remision.valorTotal - amount;

        percentagePreview.textContent = `${percentage.toFixed(2) || 0}%`;
        newTotalPreview.textContent = formatCurrency(newTotal);
    });

    document.getElementById('discount-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const discountAmount = unformatCurrency(amountInput.value);
        if (isNaN(discountAmount) || discountAmount <= 0) {
            showModalMessage("Por favor, ingresa un valor de descuento válido.");
            return;
        }
        if (discountAmount > maxDiscount) {
            showModalMessage(`El descuento no puede ser mayor a ${formatCurrency(maxDiscount)} (5%).`);
            return;
        }
        
        const newTotal = remision.valorTotal - discountAmount;
        const percentage = (discountAmount / remision.valorTotal) * 100;

        const updatedData = {
            valorTotal: newTotal,
            discount: {
                percentage: percentage,
                amount: discountAmount,
                appliedBy: currentUser.uid,
                appliedAt: new Date()
            }
        };

        showModalMessage("Aplicando descuento...", true);
        try {
            await updateDoc(doc(db, "remisiones", remision.id), updatedData);
            hideModal();
            showModalMessage("¡Descuento aplicado con éxito!", false, 2000);
        } catch (error) {
            console.error("Error al aplicar descuento:", error);
            showModalMessage("Error al aplicar el descuento.");
        }
    });
}
