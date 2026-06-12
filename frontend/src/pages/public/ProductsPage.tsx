import { Link } from 'react-router-dom';

const products = [
  { title: 'Gasolina', image: '/images/produto-gasolina.svg', text: 'Combustível com procedência e qualidade para desempenho, rendimento e confiança no dia a dia.' },
  { title: 'Etanol', image: '/images/produto-etanol.svg', text: 'Energia limpa, eficiente e confiável para quem busca economia sem abrir mão da qualidade.' },
  { title: 'Diesel', image: '/images/produto-diesel.svg', text: 'Força, resistência e segurança para veículos de trabalho, estrada e alta exigência.' },
  { title: 'Lubrificantes', image: '/images/produto-lubrificantes.svg', text: 'Proteção para o motor, melhor conservação dos componentes e mais tranquilidade para rodar.' },
];

export default function ProductsPage() {
  return (
    <>
      <section className="page-hero products-hero">
        <div className="container page-hero__content">
          <span className="section-kicker">Produtos</span>
          <h1>Combustíveis e lubrificantes com padrão de excelência.</h1>
          <p>Selecionamos produtos para entregar qualidade, confiança e melhor desempenho para o seu veículo.</p>
        </div>
      </section>

      <section className="container content-section">
        <div className="products-grid">
          {products.map((product) => (
            <article className="product-card" key={product.title}>
              <img src={product.image} alt={product.title} />
              <div>
                <h2>{product.title}</h2>
                <p>{product.text}</p>
              </div>
            </article>
          ))}
        </div>
        <div className="products-cta">
          <h2>Abasteça com segurança no Posto Via 14.</h2>
          <p>Estamos prontos para atender você com agilidade, cuidado e confiança.</p>
          <Link to="/contato" className="btn btn--primary">Entrar em contato</Link>
        </div>
      </section>
    </>
  );
}
