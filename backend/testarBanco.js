import { db } from "./db.js";

try {
  const resultado = await db.query("SELECT NOW() AS agora");
  console.log("Banco conectado com sucesso:", resultado.rows[0]);
} catch (error) {
  console.error("Erro ao conectar no banco:", error.message);
} finally {
  await db.end();
}