import { db } from './firebase-config.js';
import { collection, query, orderBy, onSnapshot, addDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { setAllGastos, allGastos, currentUser, allProveedores } from './main.js';
import { showModalMessage, hideModal, formatCurrency, unformatCurrency, initSearchableInput, autoFormatCurrency } from './ui.js';

export function setupGastosEventListeners() {
    document.getElementById('add-gasto-form').addEventListener('submit', handleGastoSubmit);
    document.getElementById('search-gastos').addEventListener('input', renderGastos);
    document.getElementById('filter-gastos-month').addEventListener('change', renderGastos);
    document.getElementById('filter-gastos-year').addEventListener('change', renderGastos);
    
    const valorTotalInput = document.getElementById('gasto-valor-total');
    valorTotalInput.addEventListener('input', autoFormatCurrency);

    flatpickr("#gasto-fecha", {
        defaultDate: "today",
        dateFormat: "Y-m-d",
    });

    const proveedorSearchInput = document.getElementById('proveedor-search-input');
    const proveedorSearchResults = document.getElementById('proveedor-search-results');
    const proveedorIdHidden = document.getElementById('proveedor-id-hidden');
    initSearchableInput(proveedorSearchInput, proveedorSearchResults, () => allProveedores, (proveedor) => proveedor.nombre, (selectedProvider) => {
        proveedorIdHidden.value = selectedProvider ? selectedProvider.id : '';
    });
}

export function loadGastos() {
    const q = query(collection(db, "gastos"), orderBy("fecha", "desc"));
    onSnapshot(q, (snapshot) => {
        const gastos = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setAllGastos(gastos);
        renderGastos();
    });
}

function renderGastos() {
    const gastosListEl = document.getElementById('gastos-list');
    if(!gastosListEl) return;

    const month = document.getElementById('filter-gastos-month').value;
    const year = document.getElementById('filter-gastos-year').value;
    const searchTerm = document.getElementById('search-gastos').value.toLowerCase();
    
    let filtered = allGastos;

    if (year !== 'all') {
        filtered = filtered.filter(g => new Date(g.fecha).getFullYear() == year);
    }
    if (month !== 'all') {
        filtered = filtered.filter(g => new Date(g.fecha).getMonth() == month);
    }
    if (searchTerm) {
        filtered = filtered.filter(g => g.proveedorNombre.toLowerCase().includes(searchTerm) || (g.numeroFactura && g.numeroFactura.toLowerCase().includes(searchTerm)));
    }

    gastosListEl.innerHTML = '';
    if (filtered.length === 0) { gastosListEl.innerHTML = '<p class="text-center text-gray-500 py-8">No hay gastos registrados.</p>'; return; }
    filtered.forEach((gasto) => {
        const el = document.createElement('div');
        el.className = 'border p-4 rounded-lg flex justify-between items-center';
        el.innerHTML = `
            <div>
                <p class="font-semibold">${gasto.proveedorNombre}</p>
                <p class="text-sm text-gray-600">${gasto.fecha} ${gasto.numeroFactura ? `| Factura: ${gasto.numeroFactura}` : ''}</p>
            </div>
            <div class="text-right">
                <p class="font-bold text-lg text-red-600">${formatCurrency(gasto.valorTotal)}</p>
                <p class="text-sm text-gray-500">Pagado con: ${gasto.fuentePago}</p>
            </div>
        `;
        gastosListEl.appendChild(el);
    });
}

async function handleGastoSubmit(e) {
    e.preventDefault();
    const valorTotal = unformatCurrency(document.getElementById('gasto-valor-total').value);
    const ivaIncluido = document.getElementById('gasto-iva').checked;
    const valorBase = ivaIncluido ? valorTotal / 1.19 : valorTotal;
    const proveedorId = document.getElementById('proveedor-id-hidden').value;
    const proveedorNombre = document.getElementById('proveedor-search-input').value;
    
    if (!proveedorId) {
        showModalMessage("Por favor, selecciona un proveedor de la lista.");
        return;
    }

    const nuevoGasto = {
        fecha: document.getElementById('gasto-fecha').value,
        proveedorId: proveedorId,
        proveedorNombre: proveedorNombre,
        numeroFactura: document.getElementById('gasto-factura').value,
        valorBase: valorBase,
        ivaIncluido: ivaIncluido,
        valorTotal: valorTotal,
        fuentePago: document.getElementById('gasto-fuente').value,
        registradoPor: currentUser.uid,
        timestamp: new Date(),
    };
    showModalMessage("Registrando gasto...", true);
    try {
        await addDoc(collection(db, "gastos"), nuevoGasto);
        e.target.reset();
        document.getElementById('proveedor-search-input').value = '';
        document.getElementById('proveedor-id-hidden').value = '';
        hideModal();
        showModalMessage("¡Gasto registrado con éxito!", false, 2000);
    } catch (error) {
        console.error("Error al registrar gasto:", error);
        hideModal();
        showModalMessage("Error al registrar el gasto.");
    }
}
