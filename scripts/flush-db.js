import admin from "firebase-admin";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

let serviceAccount;
try {
  serviceAccount = JSON.parse(readFileSync(join(__dirname, "serviceAccount.json"), "utf8"));
} catch (err) {
  console.error("❌ serviceAccount.json not found in scripts/");
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
db.settings({ databaseId: "asat" });

async function flush() {
  console.log("🚀 Starting database flush...");

  // 1. Fetch all admin UIDs to preserve
  console.log("🔐 Fetching admin accounts to preserve...");
  const adminSnap = await db.collection("admins").get();
  const adminUids = new Set(adminSnap.docs.map(doc => doc.id));
  console.log(`   Preserving ${adminUids.size} admin account(s):`, Array.from(adminUids));

  // 2. Delete all Auth users except admin UIDs
  console.log("\n👤 Cleaning up Firebase Authentication users...");
  let nextPageToken;
  let deletedAuthUsersCount = 0;
  do {
    const listUsersResult = await admin.auth().listUsers(1000, nextPageToken);
    const usersToDelete = listUsersResult.users
      .filter(user => !adminUids.has(user.uid))
      .map(user => user.uid);

    if (usersToDelete.length > 0) {
      await admin.auth().deleteUsers(usersToDelete);
      deletedAuthUsersCount += usersToDelete.length;
      console.log(`   Deleted ${usersToDelete.length} auth user(s)`);
    }
    nextPageToken = listUsersResult.pageToken;
  } while (nextPageToken);
  console.log(`   ✓ Done. Total auth users deleted: ${deletedAuthUsersCount}`);

  // 3. Delete all Firestore collections except 'admins'
  console.log("\n🗄️ Cleaning up Firestore collections...");
  const collections = await db.listCollections();
  for (const collection of collections) {
    const name = collection.id;
    if (name === "admins") {
      console.log(`   - Preserving collection: '${name}'`);
      continue;
    }
    console.log(`   - Deleting collection: '${name}'...`);
    
    // Delete documents in batches
    const query = collection.limit(500);
    let deletedDocsCount = 0;
    while (true) {
      const snap = await query.get();
      if (snap.empty) break;
      
      const batch = db.batch();
      snap.docs.forEach(doc => {
        batch.delete(doc.ref);
      });
      await batch.commit();
      deletedDocsCount += snap.size;
    }
    console.log(`     ✓ Deleted ${deletedDocsCount} documents from '${name}'`);
  }

  console.log("\n🎉 Database flush complete! Only master/admin accounts remain.");
  process.exit(0);
}

flush().catch(err => {
  console.error("❌ Flush failed:", err);
  process.exit(1);
});
