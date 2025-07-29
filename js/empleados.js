import { db, storage } from './firebase-config.js';
import { collection, query, onSnapshot, doc, updateDoc, deleteDoc, where, getDocs, addDoc, getDoc, deleteField, arrayUnion } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { updateEmail } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { currentUser, currentUserData, allRemisiones, allGastos, allClientes } from './main.js';
import { showModalMessage, hideModal, formatCurrency, unformatCurrency, autoFormatCurrency, populateDateFilters, showPdfModal } from './ui.js';

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

// --- EVENT LISTENERS PRINCIPALES DEL MÓDULO ---
export function setupEmpleadoEventListeners() {
    document.getElementById('summary-btn').addEventListener('click', showDashboardModal);
    document.getElementById('edit-profile-btn').addEventListener('click', showEditProfileModal);
    document.getElementById('loan-request-btn').addEventListener('click', showLoanRequestModal);
}

// --- CARGA DE DATOS DE EMPLEADOS (VISTA ADMIN) ---
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

// --- MODAL PRINCIPAL DE RESUMEN (DASHBOARD) ---
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
            <div id="dashboard-content" class="p-6 overflow-y-auto flex-grow"></div>
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

// --- PESTAÑA 1: RESUMEN MENSUAL ---
function renderResumenMensualTab(container) {
    container.innerHTML = `
        <div class="flex justify-between items-center mb-4 flex-wrap gap-4">
            <div>
                <label for="summary-month" class="text-sm font-medium">Análisis Rápido por Periodo:</label>
                <div class="flex gap-2 mt-1">
                    <select id="summary-month" class="p-2 border rounded-lg bg-white"></select>
                    <select id="summary-year" class="p-2 border rounded-lg bg-white"></select>
                </div>
            </div>
            <div class="flex gap-2">
                 <button id="download-global-report-btn" class="bg-green-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-green-700">Reporte Global</button>
                 <button id="download-detailed-report-btn" class="bg-blue-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-blue-700">Reporte Detallado</button>
            </div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div class="bg-green-100 p-4 rounded-lg"><p class="text-sm text-green-800">Ventas (Confirmadas)</p><p id="summary-sales" class="text-2xl font-bold text-green-900"></p></div>
            <div class="bg-red-100 p-4 rounded-lg"><p class="text-sm text-red-800">Gastos</p><p id="summary-expenses" class="text-2xl font-bold text-red-900"></p></div>
            <div class="bg-blue-100 p-4 rounded-lg"><p class="text-sm text-blue-800">Utilidad / Pérdida</p><p id="summary-profit" class="text-2xl font-bold text-blue-900"></p></div>
            <div class="bg-yellow-100 p-4 rounded-lg"><p class="text-sm text-yellow-800">Cartera Pendiente (Mes)</p><p id="summary-cartera-mes" class="text-2xl font-bold text-yellow-900"></p></div>
        </div>
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div class="lg:col-span-2 bg-gray-50 p-4 rounded-lg">
                <h3 class="font-semibold mb-2">Tendencia Utilidad/Pérdida (Últimos 6 Meses)</h3>
                <canvas id="profitLossChart"></canvas>
            </div>
            <div class="bg-gray-50 p-4 rounded-lg">
                <h3 class="font-semibold mb-4 text-lg">Dinero Disponible (Histórico)</h3>
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-4">
                    <div class="bg-white p-4 rounded-lg shadow"><p class="text-sm text-gray-600">Efectivo</p><p id="summary-efectivo" class="text-2xl font-bold"></p></div>
                    <div class="bg-white p-4 rounded-lg shadow"><p class="text-sm text-gray-600">Nequi</p><p id="summary-nequi" class="text-2xl font-bold"></p></div>
                    <div class="bg-white p-4 rounded-lg shadow"><p class="text-sm text-gray-600">Davivienda</p><p id="summary-davivienda" class="text-2xl font-bold"></p></div>
                    <div class="bg-white p-4 rounded-lg shadow"><p class="text-sm text-red-700">Cartera por Cobrar</p><p id="summary-cartera-total" class="text-2xl font-bold text-red-700"></p></div>
                </div>
            </div>
        </div>
    `;
    populateDateFilters('summary');
    const monthSelect = document.getElementById('summary-month');
    const yearSelect = document.getElementById('summary-year');
    
    const now = new Date();
    monthSelect.value = now.getMonth();
    yearSelect.value = now.getFullYear();

    const updateView = () => updateResumenMensualView(parseInt(monthSelect.value), parseInt(yearSelect.value));
    
    monthSelect.addEventListener('change', updateView);
    yearSelect.addEventListener('change', updateView);
    document.getElementById('download-detailed-report-btn').addEventListener('click', () => showDateRangeModal(generateAndDownloadDetailedReport));
    document.getElementById('download-global-report-btn').addEventListener('click', () => showDateRangeModal(generateAndDownloadGlobalReport));

    updateView();
}

// --- PESTAÑA 2: CARTERA ---
function renderCarteraTab(container) {
    container.innerHTML = `
        <h3 class="text-xl font-semibold text-gray-800 mb-4">Cartera Pendiente de Cobro</h3>
        <div id="cartera-list" class="space-y-3"></div>
    `;
    updateCarteraView();
}

// --- PESTAÑA 3: CLIENTES ---
function renderClientesTab(container) {
    container.innerHTML = `
        <div class="flex justify-between items-center mb-4 flex-wrap gap-4">
             <h3 class="text-xl font-semibold text-gray-800">Ranking de Clientes por Ingresos</h3>
            <div>
                <label class="text-sm font-medium">Periodo:</label>
                <div class="flex gap-2 mt-1">
                    <input type="text" id="cliente-rank-start" class="p-2 border rounded-lg bg-white" placeholder="Fecha de inicio">
                    <input type="text" id="cliente-rank-end" class="p-2 border rounded-lg bg-white" placeholder="Fecha de fin">
                </div>
            </div>
        </div>
        <div id="clientes-rank-list"></div>
    `;

    const startDateInput = document.getElementById('cliente-rank-start');
    const endDateInput = document.getElementById('cliente-rank-end');
    
    const today = new Date();
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    
    flatpickr(startDateInput, { dateFormat: "Y-m-d", defaultDate: firstDayOfMonth });
    flatpickr(endDateInput, { dateFormat: "Y-m-d", defaultDate: today });

    const updateView = () => updateClientesRankView(startDateInput.value, endDateInput.value);

    startDateInput.addEventListener('change', updateView);
    endDateInput.addEventListener('change', updateView);

    updateView();
}


// --- LÓGICA DE ACTUALIZACIÓN PARA LAS PESTAÑAS ---

function updateResumenMensualView(month, year) {
    // Cálculos para el período seleccionado
    const remisionesMes = allRemisiones.filter(r => r.estado !== 'Anulada' && new Date(r.fechaRecibido).getMonth() === month && new Date(r.fechaRecibido).getFullYear() === year);
    const pagosMes = allRemisiones.flatMap(r => r.payments || []).filter(p => p.status === 'confirmado' && new Date(p.date).getMonth() === month && new Date(p.date).getFullYear() === year);
    const gastosMes = allGastos.filter(g => new Date(g.fecha).getMonth() === month && new Date(g.fecha).getFullYear() === year);

    const ventas = pagosMes.reduce((sum, p) => sum + p.amount, 0);
    const gastos = gastosMes.reduce((sum, g) => sum + g.valorTotal, 0);
    const utilidad = ventas - gastos;
    const carteraMes = remisionesMes.reduce((sum, r) => {
        const totalPagado = (r.payments || []).filter(p => p.status === 'confirmado').reduce((s, p) => s + p.amount, 0);
        return sum + (r.valorTotal - totalPagado);
    }, 0);

    document.getElementById('summary-sales').textContent = formatCurrency(ventas);
    document.getElementById('summary-expenses').textContent = formatCurrency(gastos);
    document.getElementById('summary-profit').textContent = formatCurrency(utilidad);
    document.getElementById('summary-cartera-mes').textContent = formatCurrency(carteraMes);

    // Cálculos históricos para Saldos Actuales
    const todosLosPagos = allRemisiones.flatMap(r => r.payments || []).filter(p => p.status === 'confirmado');
    const totalIngresosEfectivo = todosLosPagos.filter(p => p.method === 'Efectivo').reduce((s, p) => s + p.amount, 0);
    const totalIngresosNequi = todosLosPagos.filter(p => p.method === 'Nequi').reduce((s, p) => s + p.amount, 0);
    const totalIngresosDavivienda = todosLosPagos.filter(p => p.method === 'Davivienda').reduce((s, p) => s + p.amount, 0);

    const totalGastosEfectivo = allGastos.filter(g => g.fuentePago === 'Efectivo').reduce((s, g) => s + g.valorTotal, 0);
    const totalGastosNequi = allGastos.filter(g => g.fuentePago === 'Nequi').reduce((s, g) => s + g.valorTotal, 0);
    const totalGastosDavivienda = allGastos.filter(g => g.fuentePago === 'Davivienda').reduce((s, g) => s + g.valorTotal, 0);

    const saldoEfectivo = totalIngresosEfectivo - totalGastosEfectivo;
    const saldoNequi = totalIngresosNequi - totalGastosNequi;
    const saldoDavivienda = totalIngresosDavivienda - totalGastosDavivienda;
    
    const totalCartera = allRemisiones.filter(r => r.estado !== 'Anulada').reduce((sum, r) => {
        const totalPagado = (r.payments || []).filter(p => p.status === 'confirmado').reduce((s, p) => s + p.amount, 0);
        const saldo = r.valorTotal - totalPagado;
        return sum + (saldo > 0.1 ? saldo : 0);
    }, 0);

    document.getElementById('summary-efectivo').textContent = formatCurrency(saldoEfectivo);
    document.getElementById('summary-nequi').textContent = formatCurrency(saldoNequi);
    document.getElementById('summary-davivienda').textContent = formatCurrency(saldoDavivienda);
    document.getElementById('summary-cartera-total').textContent = formatCurrency(totalCartera);

    // Gráfico de tendencia
    const monthNames = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
    const labels = [];
    const profitData = [];
    for (let i = 5; i >= 0; i--) {
        const d = new Date();
        d.setMonth(d.getMonth() - i);
        const m = d.getMonth();
        const y = d.getFullYear();
        labels.push(monthNames[m]);
        const monthlyPayments = allRemisiones.flatMap(r => r.payments || []).filter(p => { const pDate = new Date(p.date); return p.status === 'confirmado' && pDate.getMonth() === m && pDate.getFullYear() === y; }).reduce((sum, p) => sum + p.amount, 0);
        const monthlyExpenses = allGastos.filter(g => { const gDate = new Date(g.fecha); return gDate.getMonth() === m && gDate.getFullYear() === y; }).reduce((sum, g) => sum + g.valorTotal, 0);
        profitData.push(monthlyPayments - monthlyExpenses);
    }
    const ctx = document.getElementById('profitLossChart').getContext('2d');
    if (profitLossChart) {
        profitLossChart.destroy();
    }
    profitLossChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Utilidad / Pérdida',
                data: profitData,
                backgroundColor: profitData.map(p => p >= 0 ? 'rgba(75, 192, 192, 0.6)' : 'rgba(255, 99, 132, 0.6)'),
                borderColor: profitData.map(p => p >= 0 ? 'rgba(75, 192, 192, 1)' : 'rgba(255, 99, 132, 1)'),
                borderWidth: 1
            }]
        },
        options: { scales: { y: { beginAtZero: true } } }
    });
}

function updateCarteraView() {
    const carteraListEl = document.getElementById('cartera-list');
    const remisionesPendientes = allRemisiones.filter(r => {
        if (r.estado === 'Anulada') return false;
        const totalPagado = (r.payments || []).filter(p => p.status === 'confirmado').reduce((s, p) => s + p.amount, 0);
        return r.valorTotal - totalPagado > 0.1;
    });

    if (remisionesPendientes.length === 0) {
        carteraListEl.innerHTML = '<p class="text-center text-gray-500 py-8">¡Excelente! No hay cartera pendiente.</p>';
        return;
    }

    const today = new Date();
    remisionesPendientes.forEach(r => {
        const fechaRecibido = new Date(r.fechaRecibido);
        const diffTime = Math.abs(today - fechaRecibido);
        r.diasVencido = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    });

    remisionesPendientes.sort((a, b) => b.diasVencido - a.diasVencido);

    let listHTML = remisionesPendientes.map(r => {
        const totalPagado = (r.payments || []).filter(p => p.status === 'confirmado').reduce((s, p) => s + p.amount, 0);
        const saldo = r.valorTotal - totalPagado;
        return `
            <div class="border p-4 rounded-lg flex justify-between items-center">
                <div>
                    <p class="font-semibold">${r.clienteNombre} <span class="text-sm font-normal text-gray-500">| Remisión N° ${r.numeroRemision}</span></p>
                    <p class="text-sm text-gray-600">Fecha Recibido: ${r.fechaRecibido}</p>
                </div>
                <div class="text-right">
                    <p class="font-bold text-lg text-red-600">Pendiente: ${formatCurrency(saldo)}</p>
                    <p class="text-sm font-semibold ${r.diasVencido > 30 ? 'text-red-700' : 'text-yellow-700'}">${r.diasVencido} días vencido</p>
                </div>
            </div>
        `;
    }).join('');

    const totalGeneralCartera = remisionesPendientes.reduce((sum, r) => {
        const totalPagado = (r.payments || []).filter(p => p.status === 'confirmado').reduce((s, p) => s + p.amount, 0);
        return sum + (r.valorTotal - totalPagado);
    }, 0);

    listHTML += `
        <div class="border-t-2 mt-4 pt-4 flex justify-end items-center">
            <p class="text-lg font-bold">Total Cartera Pendiente:</p>
            <p class="text-lg font-bold text-red-600 ml-4">${formatCurrency(totalGeneralCartera)}</p>
        </div>
    `;

    carteraListEl.innerHTML = listHTML;
}

function updateClientesRankView(startDate, endDate) {
    const listEl = document.getElementById('clientes-rank-list');
    if (!startDate || !endDate) return;
    
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999); 

    const remisionesEnRango = allRemisiones.filter(r => {
        if (r.estado === 'Anulada') return false;
        const rDate = new Date(r.fechaRecibido);
        return rDate >= start && rDate <= end;
    });

    const ingresosPorCliente = {};
    remisionesEnRango.forEach(r => {
        if (!ingresosPorCliente[r.idCliente]) {
            ingresosPorCliente[r.idCliente] = { total: 0, nombre: r.clienteNombre, count: 0 };
        }
        ingresosPorCliente[r.idCliente].total += r.valorTotal;
        ingresosPorCliente[r.idCliente].count += 1;
    });

    const rankedClientes = Object.values(ingresosPorCliente).sort((a, b) => b.total - a.total);

    if (rankedClientes.length === 0) {
        listEl.innerHTML = '<p class="text-center text-gray-500 py-8">No hay actividad de clientes en este periodo.</p>';
        return;
    }

    listEl.innerHTML = rankedClientes.map((cliente, index) => `
        <div class="flex items-center justify-between p-3 border-b">
            <div class="flex items-center">
                <span class="text-lg font-bold text-gray-400 w-8">${index + 1}.</span>
                <div>
                    <p class="font-semibold">${cliente.nombre}</p>
                    <p class="text-sm text-gray-500">${cliente.count} ${cliente.count === 1 ? 'compra' : 'compras'}</p>
                </div>
            </div>
            <p class="font-bold text-green-700 text-lg">${formatCurrency(cliente.total)}</p>
        </div>
    `).join('');
}

function showDateRangeModal(callback) {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    modalContentWrapper.innerHTML = `
        <div class="bg-white rounded-lg p-6 shadow-xl max-w-sm w-full mx-auto text-left">
            <h2 class="text-xl font-semibold mb-4">Seleccionar Rango de Fechas</h2>
            <div class="space-y-4">
                <div>
                    <label for="report-start-date" class="block text-sm font-medium">Desde:</label>
                    <input type="text" id="report-start-date" class="w-full p-2 border rounded-lg mt-1" placeholder="Seleccionar fecha...">
                </div>
                <div>
                    <label for="report-end-date" class="block text-sm font-medium">Hasta:</label>
                    <input type="text" id="report-end-date" class="w-full p-2 border rounded-lg mt-1" placeholder="Seleccionar fecha...">
                </div>
                <div class="flex justify-end gap-2 pt-2">
                    <button id="cancel-report-btn" class="bg-gray-200 px-4 py-2 rounded-lg">Cancelar</button>
                    <button id="generate-report-btn" class="bg-blue-600 text-white px-4 py-2 rounded-lg">Generar</button>
                </div>
            </div>
        </div>
    `;

    flatpickr("#report-start-date", { dateFormat: "Y-m-d" });
    flatpickr("#report-end-date", { dateFormat: "Y-m-d", defaultDate: "today" });

    document.getElementById('generate-report-btn').addEventListener('click', () => {
        const startDate = document.getElementById('report-start-date').value;
        const endDate = document.getElementById('report-end-date').value;
        if (!startDate || !endDate) {
            showModalMessage("Por favor, selecciona ambas fechas.");
            return;
        }
        hideModal(); // Cierra el modal de fechas
        callback(startDate, endDate);
    });
    document.getElementById('cancel-report-btn').addEventListener('click', hideModal);
}

async function generateAndDownloadDetailedReport(startDate, endDate) {
    showModalMessage("Generando reporte detallado...", true);
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const period = `${startDate} al ${endDate}`;
    
    doc.setFontSize(18);
    doc.text("Reporte Financiero Detallado", 14, 22);
    doc.setFontSize(11);
    doc.text(`Periodo: ${period}`, 14, 30);

    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    const pagosRango = allRemisiones.flatMap(r => r.payments || []).filter(p => { const pDate = new Date(p.date); return p.status === 'confirmado' && pDate >= start && pDate <= end; });
    const gastosRango = allGastos.filter(g => { const gDate = new Date(g.fecha); return gDate >= start && gDate <= end; });

    const ventas = pagosRango.reduce((sum, p) => sum + p.amount, 0);
    const gastos = gastosRango.reduce((sum, g) => sum + g.valorTotal, 0);
    const utilidad = ventas - gastos;

    const summaryData = [
        ['Ventas (Ingresos Confirmados)', formatCurrency(ventas)],
        ['Total Gastos', formatCurrency(gastos)],
        ['Utilidad / Pérdida', formatCurrency(utilidad)]
    ];
    
    doc.autoTable({ startY: 40, head: [['Concepto', 'Valor']], body: summaryData });
    let finalY = doc.lastAutoTable.finalY;

    if (pagosRango.length > 0) {
        doc.text("Detalle de Ingresos", 14, finalY + 15);
        const ingresosBody = pagosRango.map(p => {
            const remision = allRemisiones.find(r => r.payments && r.payments.some(pay => pay.registeredAt === p.registeredAt));
            return [p.date, remision ? remision.clienteNombre : 'N/A', p.method, formatCurrency(p.amount)];
        });
        doc.autoTable({ startY: finalY + 20, head: [['Fecha', 'Cliente', 'Método', 'Monto']], body: ingresosBody });
        finalY = doc.lastAutoTable.finalY;
    }

    if (gastosRango.length > 0) {
        doc.text("Detalle de Gastos", 14, finalY + 15);
        const gastosBody = gastosRango.map(g => [g.fecha, g.proveedorNombre, g.numeroFactura || 'N/A', formatCurrency(g.valorTotal)]);
        doc.autoTable({ startY: finalY + 20, head: [['Fecha', 'Proveedor', 'Factura', 'Monto']], body: gastosBody });
    }

    doc.save(`Reporte_Detallado_${period}.pdf`);
    hideModal();
}

async function generateAndDownloadGlobalReport(startDate, endDate) {
    showModalMessage("Generando reporte global...", true);
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const period = `${startDate} al ${endDate}`;
    
    doc.setFontSize(18);
    doc.text("Reporte Financiero Global", 14, 22);
    doc.setFontSize(11);
    doc.text(`Periodo: ${period}`, 14, 30);

    const start = new Date(startDate);
    const end = new Date(endDate);
    const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    const monthlyData = [];

    for (let d = new Date(start); d <= end; d.setMonth(d.getMonth() + 1)) {
        const month = d.getMonth();
        const year = d.getFullYear();
        const endOfMonth = new Date(year, month + 1, 0);

        const pagosMes = allRemisiones.flatMap(r => r.payments || []).filter(p => p.status === 'confirmado' && new Date(p.date).getMonth() === month && new Date(p.date).getFullYear() === year);
        const gastosMes = allGastos.filter(g => new Date(g.fecha).getMonth() === month && new Date(g.fecha).getFullYear() === year);
        
        const ventas = pagosMes.reduce((sum, p) => sum + p.amount, 0);
        const gastos = gastosMes.reduce((sum, g) => sum + g.valorTotal, 0);
        const utilidad = ventas - gastos;

        const carteraAlCierre = allRemisiones.filter(r => new Date(r.fechaRecibido) <= endOfMonth && r.estado !== 'Anulada')
            .reduce((sum, r) => {
                const totalPagado = (r.payments || []).filter(p => p.status === 'confirmado' && new Date(p.date) <= endOfMonth).reduce((s, p) => s + p.amount, 0);
                const saldo = r.valorTotal - totalPagado;
                return sum + (saldo > 0.1 ? saldo : 0);
            }, 0);

        monthlyData.push([
            `${monthNames[month]} ${year}`,
            formatCurrency(ventas),
            formatCurrency(gastos),
            formatCurrency(utilidad),
            formatCurrency(carteraAlCierre)
        ]);
    }

    doc.autoTable({
        startY: 40,
        head: [['Mes', 'Ventas', 'Gastos', 'Utilidad/Pérdida', 'Cartera al Cierre']],
        body: monthlyData,
    });
    let finalY = doc.lastAutoTable.finalY;

    // Saldos Actuales
    const todosLosPagos = allRemisiones.flatMap(r => r.payments || []).filter(p => p.status === 'confirmado');
    const saldoEfectivo = todosLosPagos.filter(p => p.method === 'Efectivo').reduce((s, p) => s + p.amount, 0) - allGastos.filter(g => g.fuentePago === 'Efectivo').reduce((s, g) => s + g.valorTotal, 0);
    const saldoNequi = todosLosPagos.filter(p => p.method === 'Nequi').reduce((s, p) => s + p.amount, 0) - allGastos.filter(g => g.fuentePago === 'Nequi').reduce((s, g) => s + g.valorTotal, 0);
    const saldoDavivienda = todosLosPagos.filter(p => p.method === 'Davivienda').reduce((s, p) => s + p.amount, 0) - allGastos.filter(g => g.fuentePago === 'Davivienda').reduce((s, g) => s + g.valorTotal, 0);
    const totalCartera = allRemisiones.filter(r => r.estado !== 'Anulada').reduce((sum, r) => {
        const totalPagado = (r.payments || []).filter(p => p.status === 'confirmado').reduce((s, p) => s + p.amount, 0);
        return sum + (r.valorTotal - totalPagado > 0.1 ? r.valorTotal - totalPagado : 0);
    }, 0);

    doc.text("Saldos Totales Actuales", 14, finalY + 15);
    doc.autoTable({
        startY: finalY + 20,
        body: [
            ['Saldo Efectivo', formatCurrency(saldoEfectivo)],
            ['Saldo Nequi', formatCurrency(saldoNequi)],
            ['Saldo Davivienda', formatCurrency(saldoDavivienda)],
            ['Total Cartera por Cobrar', formatCurrency(totalCartera)],
        ],
    });

    doc.save(`Reporte_Global_${period}.pdf`);
    hideModal();
}


// --- MODAL DE EDICIÓN DE PERFIL ---
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
                <div><label for="profile-dob" class="block text-sm font-medium">Fecha de Nacimiento</label><input type="text" id="profile-dob" class="w-full p-2 border rounded-lg mt-1" value="${user.dob || ''}" placeholder="Seleccionar fecha..." required></div>
                <div><label for="profile-email" class="block text-sm font-medium">Correo Electrónico</label><input type="email" id="profile-email" class="w-full p-2 border rounded-lg mt-1" value="${user.email || ''}" required></div>
                <div><label for="profile-address" class="block text-sm font-medium">Dirección</label><input type="text" id="profile-address" class="w-full p-2 border rounded-lg mt-1" value="${user.direccion || ''}"></div>
                <div class="flex justify-end pt-4">
                    <button type="submit" class="w-full bg-indigo-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-indigo-700">Guardar Cambios</button>
                </div>
            </form>
        </div>
    `;
    
    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('close-profile-modal').addEventListener('click', hideModal);
    flatpickr("#profile-dob", { dateFormat: "Y-m-d" });

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

// --- MODAL DE SOLICITUD DE PRÉSTAMO ---
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

// --- MODAL DE GESTIÓN DE RRHH (ADMIN) ---
function showRRHHModal(empleado, activeTab = 'contratacion', activeYear = new Date().getFullYear()) {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    modalContentWrapper.innerHTML = `
        <div class="bg-white rounded-lg shadow-xl w-full max-w-5xl mx-auto text-left flex flex-col" style="max-height: 90vh;">
            <div class="flex justify-between items-center p-4 border-b">
                <h2 class="text-xl font-semibold">Recursos Humanos: ${empleado.nombre}</h2>
                <button id="close-rrhh-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
            </div>
            <div class="border-b border-gray-200">
                <nav id="rrhh-nav" class="-mb-px flex space-x-6 px-6">
                    <button data-tab="contratacion" class="rrhh-tab-btn py-3 px-1 font-semibold">Datos y Contratación</button>
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
    
    document.querySelectorAll('.rrhh-tab-btn').forEach(b => b.classList.remove('active'));
    const activeTabButton = document.querySelector(`.rrhh-tab-btn[data-tab="${activeTab}"]`);
    if (activeTabButton) activeTabButton.classList.add('active');

    const renderTabContent = (tab) => {
        switch(tab) {
            case 'contratacion': renderContratacionTab(empleado, rrhhContent, activeYear); break;
            case 'pagos': renderPagosTab(empleado, rrhhContent); break;
            case 'descargos': renderDescargosTab(empleado, rrhhContent); break;
            case 'prestamos': renderPrestamosTab(empleado, rrhhContent); break;
            default: renderContratacionTab(empleado, rrhhContent, activeYear);
        }
    };

    renderTabContent(activeTab);

    document.querySelectorAll('.rrhh-tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.rrhh-tab-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            const tab = e.target.dataset.tab;
            renderTabContent(tab);
        });
    });
}

// --- MODAL DE EDICIÓN DE USUARIO (ADMIN) ---
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

// --- PESTAÑAS DEL MODAL DE RRHH ---
function renderContratacionTab(empleado, container, yearToShow) {
    const contratacionData = empleado.contratacion || {};
    const currentYear = new Date().getFullYear();
    const selectedYear = yearToShow || currentYear;
    
    const infoAnual = contratacionData[selectedYear] || {};
    const documentosAnuales = infoAnual.documentos || {};

    let yearOptions = '';
    for (let i = 0; i < 5; i++) {
        const year = currentYear - i;
        yearOptions += `<option value="${year}" ${year === selectedYear ? 'selected' : ''}>${year}</option>`;
    }

    let documentsHTML = RRHH_DOCUMENT_TYPES.map(docType => {
        const docUrl = documentosAnuales[docType.id];
        const fileInputId = `file-rrhh-${docType.id}-${empleado.id}`;
        return `
            <div class="flex justify-between items-center p-3 border-b last:border-b-0">
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
                    <h3 class="text-lg font-semibold border-b pb-2">Información Laboral General</h3>
                    <div><label class="block text-sm font-medium">Fecha de Ingreso</label><input type="text" id="rrhh-fechaIngreso" class="w-full p-2 border rounded-lg mt-1" value="${contratacionData.fechaIngreso || ''}" placeholder="Seleccionar fecha..."></div>
                    <div><label class="block text-sm font-medium">Fecha de Retiro</label><input type="text" id="rrhh-fechaRetiro" class="w-full p-2 border rounded-lg mt-1" value="${contratacionData.fechaRetiro || ''}" placeholder="Seleccionar fecha..."></div>
                    <div><label class="block text-sm font-medium">Motivo de Retiro</label><textarea id="rrhh-motivoRetiro" class="w-full p-2 border rounded-lg mt-1" rows="2">${contratacionData.motivoRetiro || ''}</textarea></div>
                    
                    <div class="flex justify-between items-center border-b pb-2 pt-4">
                         <h3 class="text-lg font-semibold">Información Anual</h3>
                         <select id="rrhh-info-year-select" class="p-2 border rounded-lg bg-white">
                            ${yearOptions}
                         </select>
                    </div>
                    <div><label class="block text-sm font-medium">Salario</label><input type="text" id="rrhh-salario" class="w-full p-2 border rounded-lg mt-1" value="${infoAnual.salario ? formatCurrency(infoAnual.salario) : ''}"></div>
                    <div><label class="block text-sm font-medium">EPS</label><input type="text" id="rrhh-eps" class="w-full p-2 border rounded-lg mt-1" value="${infoAnual.eps || ''}"></div>
                    <div><label class="block text-sm font-medium">AFP</label><input type="text" id="rrhh-afp" class="w-full p-2 border rounded-lg mt-1" value="${infoAnual.afp || ''}"></div>
                </div>
                <div class="space-y-4">
                     <h3 class="text-lg font-semibold border-b pb-2">Documentos del Año ${selectedYear}</h3>
                    <div id="rrhh-documents-list" class="border rounded-lg">${documentsHTML}</div>
                    <button type="button" id="download-all-docs-btn" class="w-full bg-green-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-green-700">Descargar Documentos del Año</button>
                </div>
            </div>
            <div class="flex justify-end mt-6">
                <button type="submit" class="bg-indigo-600 text-white font-bold py-2 px-6 rounded-lg hover:bg-indigo-700">Guardar Información</button>
            </div>
        </form>
    `;
    attachContratacionListeners(empleado, container);
}


function renderPagosTab(empleado, container) {
    container.innerHTML = `<div>Pagos y Liquidaciones para ${empleado.nombre}</div>`;
}

function renderDescargosTab(empleado, container) {
    const descargos = empleado.descargos || [];
    let historyHTML = descargos.map(d => `
        <div class="border p-4 rounded-lg">
            <div class="flex justify-between items-start">
                <div>
                    <p class="font-semibold">${d.motivo}</p>
                    <p class="text-sm text-gray-500">Fecha de Reunión: ${d.fechaReunion}</p>
                </div>
                <div class="flex gap-2">
                    ${d.documentos?.citacion ? `<button class="view-descargo-pdf-btn bg-blue-500 text-white px-3 py-1 text-sm rounded-lg" data-url="${d.documentos.citacion}">Citación</button>` : ''}
                    ${d.documentos?.acta ? `<button class="view-descargo-pdf-btn bg-blue-500 text-white px-3 py-1 text-sm rounded-lg" data-url="${d.documentos.acta}">Acta</button>` : ''}
                    ${d.documentos?.conclusion ? `<button class="view-descargo-pdf-btn bg-blue-500 text-white px-3 py-1 text-sm rounded-lg" data-url="${d.documentos.conclusion}">Conclusión</button>` : ''}
                </div>
            </div>
        </div>
    `).join('');

    if (descargos.length === 0) {
        historyHTML = '<p class="text-center text-gray-500 py-4">No hay procesos de descargos registrados.</p>';
    }

    container.innerHTML = `
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div class="space-y-4">
                <h3 class="text-lg font-semibold border-b pb-2">Registrar Descargo</h3>
                <form id="add-descargo-form" class="space-y-4">
                    <div><label for="descargo-fecha" class="block text-sm font-medium">Fecha de Reunión</label><input type="text" id="descargo-fecha" class="w-full p-2 border rounded-lg mt-1" placeholder="Seleccionar fecha..." required></div>
                    <div><label for="descargo-motivo" class="block text-sm font-medium">Motivo de Reunión</label><textarea id="descargo-motivo" class="w-full p-2 border rounded-lg mt-1" rows="3" required></textarea></div>
                    
                    <div class="space-y-2">
                        <label class="block text-sm font-medium">Adjuntar Documentos (PDF)</label>
                        <div class="flex items-center gap-2"><label for="descargo-citacion" class="bg-gray-200 text-gray-700 px-3 py-2 rounded-lg cursor-pointer hover:bg-gray-300">Citación a descargos</label><input type="file" id="descargo-citacion" class="hidden" accept=".pdf"><span id="citacion-filename" class="text-sm text-gray-500"></span></div>
                        <div class="flex items-center gap-2"><label for="descargo-acta" class="bg-gray-200 text-gray-700 px-3 py-2 rounded-lg cursor-pointer hover:bg-gray-300">Acta de descargos</label><input type="file" id="descargo-acta" class="hidden" accept=".pdf"><span id="acta-filename" class="text-sm text-gray-500"></span></div>
                        <div class="flex items-center gap-2"><label for="descargo-conclusion" class="bg-gray-200 text-gray-700 px-3 py-2 rounded-lg cursor-pointer hover:bg-gray-300">Conclusión de descargos</label><input type="file" id="descargo-conclusion" class="hidden" accept=".pdf"><span id="conclusion-filename" class="text-sm text-gray-500"></span></div>
                    </div>
                    
                    <button type="submit" class="w-full bg-indigo-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-indigo-700">Guardar Descargo</button>
                </form>
            </div>
            <div class="space-y-4">
                <h3 class="text-lg font-semibold border-b pb-2">Historial de Descargos</h3>
                <div id="descargos-history-list" class="space-y-3">${historyHTML}</div>
            </div>
        </div>
    `;
    attachDescargosListeners(empleado, container);
}

function renderPrestamosTab(empleado, container) {
    container.innerHTML = `<div>Préstamos para ${empleado.nombre}</div>`;
}

// --- LÓGICA Y MANEJADORES DE EVENTOS DE RRHH ---
function attachContratacionListeners(empleado, container) {
    const salarioInput = document.getElementById('rrhh-salario');
    salarioInput.addEventListener('input', autoFormatCurrency);
    flatpickr("#rrhh-fechaIngreso", { dateFormat: "Y-m-d" });
    flatpickr("#rrhh-fechaRetiro", { dateFormat: "Y-m-d" });

    const yearSelect = document.getElementById('rrhh-info-year-select');

    document.getElementById('contratacion-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const selectedYear = yearSelect.value;
        const updatedData = {
            "contratacion.fechaIngreso": document.getElementById('rrhh-fechaIngreso').value,
            "contratacion.fechaRetiro": document.getElementById('rrhh-fechaRetiro').value,
            "contratacion.motivoRetiro": document.getElementById('rrhh-motivoRetiro').value,
            [`contratacion.${selectedYear}.salario`]: unformatCurrency(salarioInput.value),
            [`contratacion.${selectedYear}.eps`]: document.getElementById('rrhh-eps').value,
            [`contratacion.${selectedYear}.afp`]: document.getElementById('rrhh-afp').value,
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

    yearSelect.addEventListener('change', () => {
        renderContratacionTab(empleado, container, parseInt(yearSelect.value));
    });

    document.querySelectorAll('.rrhh-file-input').forEach(input => {
        input.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            const docType = e.target.dataset.doctype;
            const year = yearSelect.value;
            if (!file || !docType) return;

            showModalMessage(`Subiendo ${docType} para ${year}...`, true);
            try {
                const storageRef = ref(storage, `rrhh/${empleado.id}/${year}/${docType}-${file.name}`);
                const snapshot = await uploadBytes(storageRef, file);
                const downloadURL = await getDownloadURL(snapshot.ref);

                const updateKey = `contratacion.${year}.documentos.${docType}`;
                await updateDoc(doc(db, "users", empleado.id), { [updateKey]: downloadURL });
                
                hideModal();
                const updatedUserDoc = await getDoc(doc(db, "users", empleado.id));
                const updatedEmpleado = { id: updatedUserDoc.id, ...updatedUserDoc.data() };
                showRRHHModal(updatedEmpleado, 'contratacion', parseInt(year));

            } catch (error) {
                console.error("Error al subir documento:", error);
                showModalMessage("Error al subir el archivo.");
            }
        });
    });

    document.querySelectorAll('.delete-rrhh-doc-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const docType = e.target.dataset.doctype;
            const year = yearSelect.value;
            handleDeleteRRHHFile(empleado, docType, year, container);
        });
    });

    document.getElementById('download-all-docs-btn').addEventListener('click', () => {
        const year = yearSelect.value;
        handleDownloadAllDocs(empleado, year);
    });
}

async function handleDeleteRRHHFile(empleado, docType, year, container) {
    if (!confirm(`¿Estás seguro de que quieres eliminar el documento "${docType}" para ${empleado.nombre} del año ${year}?`)) {
        return;
    }

    showModalMessage("Eliminando documento...", true);
    try {
        const fileUrl = empleado.contratacion?.[year]?.documentos?.[docType];

        if (fileUrl) {
            const fileRef = ref(storage, fileUrl);
            await deleteObject(fileRef).catch(error => {
                if (error.code !== 'storage/object-not-found') {
                    console.warn("File not found in storage, but proceeding to delete from Firestore record.");
                } else { throw error; }
            });
        }

        const updateKey = `contratacion.${year}.documentos.${docType}`;
        await updateDoc(doc(db, "users", empleado.id), { [updateKey]: deleteField() });

        const updatedUserDoc = await getDoc(doc(db, "users", empleado.id));
        const updatedEmpleado = { id: updatedUserDoc.id, ...updatedUserDoc.data() };
        
        renderContratacionTab(updatedEmpleado, container, parseInt(year));
        hideModal();
        showModalMessage("Documento eliminado.", false, 2000);

    } catch (error) {
        console.error("Error al eliminar documento:", error);
        hideModal();
        showModalMessage("Error al eliminar el documento.");
    }
}

async function handleDownloadAllDocs(empleado, year) {
    const documentos = empleado.contratacion?.[year]?.documentos;
    if (!documentos || Object.keys(documentos).length === 0) {
        showModalMessage(`No hay documentos para descargar para el año ${year}.`);
        return;
    }

    showModalMessage(`Preparando descarga para ${year}...`, true);
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
            link.download = `documentos_${empleado.nombre.replace(/\s/g, '_')}_${year}.zip`;
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

function attachDescargosListeners(empleado, container) {
    flatpickr("#descargo-fecha", { dateFormat: "Y-m-d", defaultDate: "today" });

    const fileInputs = {
        citacion: document.getElementById('descargo-citacion'),
        acta: document.getElementById('descargo-acta'),
        conclusion: document.getElementById('descargo-conclusion')
    };

    for (const key in fileInputs) {
        const input = fileInputs[key];
        if (input) {
            input.addEventListener('change', () => {
                const fileNameEl = document.getElementById(`${key}-filename`);
                if (fileNameEl && input.files.length > 0) {
                    fileNameEl.textContent = input.files[0].name;
                } else if (fileNameEl) {
                    fileNameEl.textContent = '';
                }
            });
        }
    }

    const form = document.getElementById('add-descargo-form');
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fechaReunion = document.getElementById('descargo-fecha').value;
            const motivo = document.getElementById('descargo-motivo').value;

            if (!fechaReunion || !motivo) {
                showModalMessage("Por favor, completa la fecha y el motivo.");
                return;
            }

            showModalMessage("Guardando descargo y subiendo archivos...", true);
            try {
                const descargoId = Date.now().toString();
                const docUrls = {};

                for (const key in fileInputs) {
                    if (fileInputs[key] && fileInputs[key].files.length > 0) {
                        const file = fileInputs[key].files[0];
                        const storageRef = ref(storage, `rrhh/${empleado.id}/descargos/${descargoId}/${key}-${file.name}`);
                        const snapshot = await uploadBytes(storageRef, file);
                        docUrls[key] = await getDownloadURL(snapshot.ref);
                    }
                }

                const newDescargo = {
                    id: descargoId,
                    fechaReunion,
                    motivo,
                    documentos: docUrls,
                    registradoPor: currentUser.uid,
                    registradoEn: new Date()
                };

                await updateDoc(doc(db, "users", empleado.id), {
                    descargos: arrayUnion(newDescargo)
                });
                
                hideModal();
                const updatedUserDoc = await getDoc(doc(db, "users", empleado.id));
                const updatedEmpleado = { id: updatedUserDoc.id, ...updatedUserDoc.data() };
                showRRHHModal(updatedEmpleado, 'descargos');
                showModalMessage("Proceso de descargo guardado con éxito.", false, 2000);

            } catch (error) {
                console.error("Error al guardar descargo:", error);
                hideModal();
                showModalMessage("Error al guardar el proceso de descargo.");
            }
        });
    }

    container.addEventListener('click', (e) => {
        if (e.target.classList.contains('view-descargo-pdf-btn')) {
            const url = e.target.dataset.url;
            showPdfModal(url, "Visor de Documento de Descargo");
        }
    });
}
