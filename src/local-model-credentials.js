const databaseName = "personal-workbench:model-credentials";
const storeName = "account-keys";
const encoder = new TextEncoder();

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Credential storage is blocked."));
  });
}

async function accountKey(account, create) {
  const candidate = create && await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, create ? "readwrite" : "readonly");
      const keys = transaction.objectStore(storeName);
      const request = keys.get(account);
      let key;
      request.onsuccess = () => {
        key = request.result;
        if (!key && candidate) {
          key = candidate;
          keys.add(key, account);
        }
      };
      transaction.oncomplete = () => resolve(key);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

function parameters(account, iv) {
  return { name: "AES-GCM", iv, additionalData: encoder.encode(databaseName + ":" + account) };
}

export async function protectLocalModelKey(account, apiKey) {
  if (!account) throw new Error("请先登录工作台。");
  try {
    const key = await accountKey(account, true);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(parameters(account, iv), key, encoder.encode(apiKey));
    return JSON.stringify({ iv: [...iv], ciphertext: [...new Uint8Array(ciphertext)] });
  } catch {
    throw new Error("浏览器无法安全保存模型连接，请检查是否允许本地站点存储。");
  }
}

export async function revealLocalModelKey(account, credential) {
  try {
    if (!account || !credential) throw new Error("No account credential.");
    const key = await accountKey(account, false);
    const { iv, ciphertext } = JSON.parse(credential);
    const decrypted = await crypto.subtle.decrypt(parameters(account, Uint8Array.from(iv)), key, Uint8Array.from(ciphertext));
    return new TextDecoder().decode(decrypted);
  } catch {
    throw new Error("本地保存的模型连接已无法读取，请在设置中重新连接。");
  }
}
