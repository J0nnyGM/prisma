import { db, auth } from './firebase-config.js';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, setDoc, collection, query, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { showModalMessage, hideModal } from './ui.js';

export function setupAuthEventListeners() {
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');

    document.getElementById('show-register-link').addEventListener('click', (e) => {
        e.preventDefault();
        loginForm.classList.add('hidden');
        registerForm.classList.remove('hidden');
    });

    document.getElementById('show-login-link').addEventListener('click', (e) => {
        e.preventDefault();
        registerForm.classList.add('hidden');
        loginForm.classList.remove('hidden');
    });

    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        signInWithEmailAndPassword(auth, email, password).catch(error => {
            console.error(error);
            showModalMessage("Error: " + error.message);
        });
    });

    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const nombre = document.getElementById('register-name').value;
        const cedula = document.getElementById('register-cedula').value;
        const telefono = document.getElementById('register-phone').value;
        const email = document.getElementById('register-email').value;
        const password = document.getElementById('register-password').value;
        const dob = document.getElementById('register-dob').value;
        const direccion = document.getElementById('register-address').value;
        
        showModalMessage("Registrando...", true);
        
        try {
            const usersCollection = collection(db, "users");
            const existingUsers = await getDocs(query(usersCollection));
            const isFirstUser = existingUsers.empty;
            const role = isFirstUser ? 'admin' : 'planta';
            const permissions = { 
                remisiones: true, 
                facturacion: isFirstUser, 
                clientes: !isFirstUser, 
                items: !isFirstUser, 
                colores: !isFirstUser, 
                gastos: !isFirstUser, 
                proveedores: !isFirstUser, 
                empleados: isFirstUser 
            };

            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;
            await setDoc(doc(db, "users", user.uid), { 
                nombre, 
                cedula, 
                email, 
                telefono, 
                dob, 
                direccion: direccion || '', 
                role, 
                creadoEn: new Date(), 
                permissions 
            });
            
            hideModal();
            showModalMessage("¡Registro exitoso! Ahora puedes iniciar sesión.", false, 3000);
            registerForm.reset();
            registerForm.classList.add('hidden');
            loginForm.classList.remove('hidden');
        } catch (error) { 
            hideModal(); 
            console.error(error); 
            showModalMessage("Error de registro: " + error.message); 
        }
    });

    document.getElementById('logout-btn').addEventListener('click', () => {
        signOut(auth);
    });
}

export async function handleAuthStateChange(user) {
    const authView = document.getElementById('auth-view');
    const appView = document.getElementById('app-view');

    if (user) {
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (userDoc.exists()) {
            const userData = { id: user.uid, ...userDoc.data() };
            document.getElementById('user-info').textContent = `Usuario: ${userData.nombre} (${userData.role})`;
            
            authView.classList.add('hidden');
            appView.classList.remove('hidden');
            
            return { authUser: user, userData: userData }; // Devuelve los datos en lugar de llamar a un setter
        } else {
            console.error("Usuario autenticado pero no encontrado en Firestore. Cerrando sesión.");
            signOut(auth);
            return { authUser: null, userData: null };
        }
    } else {
        authView.classList.remove('hidden');
        appView.classList.add('hidden');
        return { authUser: null, userData: null };
    }
}
