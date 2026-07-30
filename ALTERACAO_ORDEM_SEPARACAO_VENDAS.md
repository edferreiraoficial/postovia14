# Correção da ordem — Separação de Vendas

A ordenação geral do Financeiro Geral continua seguindo a ordem atual das colunas.

Foi criada somente esta exceção:

- as linhas do tipo `SEPARACAO_VENDAS`, inclusive descrições iniciadas por `Separação ... Vendas`, são tratadas no bloco dos produtos mesmo quando movimentam Caixa, Cartão ou outras contas;
- aparecem depois de compras, vendas e `Resultado líquido do produto`, quando existir;
- aparecem imediatamente antes de `Ajuste de saldo e valor estoque diário`;
- o restante da ordenação permanece inalterado.

A mesma regra foi aplicada na consulta do Financeiro Geral e na rotina de consolidação/reprocessamento.
