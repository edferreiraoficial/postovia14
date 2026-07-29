# Alterações desta versão

- Saldo anterior é ordenado como o primeiro lançamento do dia.
- Saldo do dia é ordenado como o último lançamento do dia.
- O antigo botão Consolidar passou a se chamar Atualizar saldos.
- A atualização permite selecionar todas as colunas ou apenas colunas específicas.
- O cálculo percorre o período em sequência, usando o saldo anterior como abertura e recalculando cada Saldo do dia.
- A página Financeiro Geral recebeu layout responsivo para celular.

## Atualizar a versão exibida

No Windows, execute na pasta do projeto:

```powershell
cd frontend
npm install
npm run build
cd ..
Remove-Item docs -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item frontend\dist docs -Recurse
npm start
```

Depois pressione Ctrl+F5 no navegador.
