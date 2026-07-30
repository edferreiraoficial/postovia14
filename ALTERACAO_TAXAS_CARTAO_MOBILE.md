# Correção de taxas individualizadas e mobile

## Taxas de cartão
- Cada lançamento "Crédito Vendas Cartão" passa a localizar o registro correspondente em `vendas_cartao` pela data presente na descrição (ex.: 31/12/25).
- Quando houver mais de um registro na mesma data, a associação prioriza a venda líquida igual ou mais próxima do valor creditado.
- Cada registro de origem é utilizado uma única vez, impedindo repetição da mesma taxa.
- A recriação e a atualização de saldos preservam uma linha "Desconto taxas Cartão" para cada crédito, vinculada pelo `registro_origem_id`.

## Mobile
- Filtros em uma única coluna, sem largura mínima de desktop.
- Datas, descrição, origem, conta e valores ficam totalmente visíveis.
- Botões de exportação e processamento em largura total.
- Paginação adaptada à largura da tela.
- Rodapé deixa de ficar sobreposto ao conteúdo no celular.
- Tabela mantém rolagem horizontal por toque.
