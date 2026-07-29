# Ajustes de saldo e data de trava

1. O lançamento **Saldo anterior** pode ser aberto com duplo clique e alterado mediante senha administrativa. O **Saldo do dia** continua automático e não pode ser editado manualmente.
2. A função **Atualizar saldos** usa o primeiro saldo visível no filtro atual como referência. Quando a data desse saldo estiver dentro ou antes do período travado, o backend inicia obrigatoriamente no primeiro dia posterior à trava.
3. O backend nunca inclui nem altera lançamentos com data igual ou inferior à data de trava durante a atualização de saldos.
4. A atualização apenas modifica linhas de saldo que já existem. Não cria **Saldo anterior** ou **Saldo do dia** em datas sem lançamentos.

## Frontend
O código-fonte foi atualizado. Para publicar no Windows, execute `ATUALIZAR_FRONTEND.bat` na raiz do projeto e depois reinicie o servidor.
