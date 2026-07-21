import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(root, 'frontend', 'dist')
const destination = path.join(root, 'docs')

if (!fs.existsSync(source)) {
  throw new Error('A pasta frontend/dist não foi encontrada. Execute o build do frontend primeiro.')
}

fs.rmSync(destination, { recursive: true, force: true })
fs.cpSync(source, destination, { recursive: true })
console.log('Frontend compilado copiado para a pasta docs.')
