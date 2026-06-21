import admin from "firebase-admin";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

let serviceAccount;
try {
  serviceAccount = JSON.parse(readFileSync(join(__dirname, "serviceAccount.json"), "utf8"));
} catch {
  console.error("❌ serviceAccount.json not found");
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
db.settings({ databaseId: "asat" });

async function listUsers() {
  const roles = ["mfg", "designers", "users", "admins"];
  for (const role of roles) {
    const snap = await db.collection(role).get();
    console.log(`\n--- ROLE: ${role} (${snap.size} docs) ---`);
    snap.docs.forEach(doc => {
      console.log(`  ID: ${doc.id} => Data:`, JSON.stringify(doc.data()));
    });
  }
}

listUsers().then(() => process.exit(0)).catch(console.error);
