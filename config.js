// ─────────────────────────────────────────────────────────────────────────────
// 1) Firebase (Pflicht für die echte Nutzung – siehe README.md)
//    Solange hier null steht, läuft die Seite im Demo-Modus (nur dieser Browser).
//    Diese Werte sind öffentlich und dürfen auf GitHub stehen.
// ─────────────────────────────────────────────────────────────────────────────
export const firebaseConfig = {
  apiKey: 'AIzaSyAAzBpq6JzfjDiN-Iimk_gwkeuG1NwnF80',
  authDomain: 'wichtel-4ae31.firebaseapp.com',
  projectId: 'wichtel-4ae31',
  storageBucket: 'wichtel-4ae31.firebasestorage.app',
  messagingSenderId: '382221750493',
  appId: '1:382221750493:web:9bba642eb02fed9d3c4b34',
};

// ─────────────────────────────────────────────────────────────────────────────
// 2) EmailJS (optional) – verschickt automatisch E-Mails mit dem persönlichen Link.
//    Ohne EmailJS öffnet die Seite stattdessen das eigene Mailprogramm.
//    Die Vorlage braucht die Variablen {{to_email}}, {{to_name}}, {{subject}}, {{message}}.
// ─────────────────────────────────────────────────────────────────────────────
export const emailjsConfig = null;
// export const emailjsConfig = {
//   publicKey: '...',
//   serviceId: 'service_...',
//   templateId: 'template_...',
// };
