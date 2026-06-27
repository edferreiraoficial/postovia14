import { extrairDadosBanco } from './tmp_test_importar.js'
const dados = await extrairDadosBanco('/mnt/data/extrato _ Banco Itaú   01-09-25 a 11-03-26.pdf', 'ITAU')
console.log('total linhas', dados.length)
for (const d of dados.filter(x=>x.data==='10/03/2026' || x.data==='09/03/2026')) console.log(d)
console.log('01/09', dados.filter(x=>x.data==='01/09/2025'))
