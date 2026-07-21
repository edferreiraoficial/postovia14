import { Link } from 'react-router-dom';
import { siteConfig } from '../../config/siteConfig';

const highlights = [
  { icon: '⛽', title: 'Combustível de qualidade', text: 'Produtos selecionados, procedência e cuidado em cada abastecimento.' },
  { icon: '🛒', title: 'Conveniência e praticidade', text: 'Uma parada completa para sua rotina em Rio Claro/SP.' },
  { icon: '🤝', title: 'Atendimento próximo', text: 'Agilidade, respeito e atenção para você seguir sempre em frente.' },
];

const fuels = ['Gasolina comum', 'Gasolina aditivada', 'Etanol', 'Diesel S10', 'Lubrificantes'];

export const HomePage = () => (
  <>
    <section className="home-hero-clean">
      <img className="home-hero-clean__image" src="/images/via14-hero.png" alt="Posto Via 14 em Rio Claro" />
    </section>

    <section className="home-intro-card">
      <div className="container home-intro-card__inner">
        <div>
          <span className="section-kicker">Posto Via 14 · Rio Claro/SP</span>
          <h1>Qualidade e confiança para o seu dia a dia.</h1>
          <p>
            Abasteça com segurança, conte com atendimento ágil e siga sempre em frente
            com a estrutura do Posto Via 14.
          </p>
        </div>
        <div className="home-hero__actions">
          <Link to="/contato" className="btn btn--primary">Como chegar</Link>
          <Link to="/produtos" className="btn btn--blue">Ver combustíveis</Link>
        </div>
      </div>
    </section>

    <section className="quick-info" aria-label="Informações principais">
      <div className="quick-info__item"><strong>{siteConfig.endereco.cidade} - {siteConfig.endereco.estado}</strong><span>{siteConfig.endereco.texto}</span></div>
      <div className="quick-info__item"><strong>Parada completa</strong><span>Combustível, conveniência e atendimento</span></div>
      <div className="quick-info__item"><strong>Fale pelo WhatsApp</strong><span>{siteConfig.contato.whatsapp}</span></div>
    </section>

    <section className="home-section home-section--white">
      <div className="container home-split">
        <div>
          <span className="section-kicker">Seu posto em Rio Claro</span>
          <h2>Uma experiência melhor para quem está na cidade, na estrada ou na rotina.</h2>
          <p>
            O Posto Via 14 une qualidade, estrutura e atendimento humano para entregar
            uma parada prática, segura e acolhedora todos os dias.
          </p>
          <div className="fuel-list">{fuels.map((fuel) => <span key={fuel}>{fuel}</span>)}</div>
        </div>
        <div className="photo-card"><img src="/images/via14-galeria.png" alt="Fotos do Posto Via 14" /></div>
      </div>
    </section>

    <section className="home-section">
      <div className="container">
        <span className="section-kicker center">Nossos diferenciais</span>
        <h2 className="section-title">Tudo para você abastecer com tranquilidade.</h2>
        <div className="feature-grid">
          {highlights.map((item) => (
            <article className="feature-card" key={item.title}>
              <div className="feature-card__icon">{item.icon}</div>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  </>
);
