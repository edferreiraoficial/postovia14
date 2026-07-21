import { Link } from 'react-router-dom';

export default function AboutPage() {
  return (
    <>
      <section className="page-hero about-hero">
        <div className="container page-hero__content">
          <span className="section-kicker">Sobre o Posto Via 14</span>
          <h1>Tradição, confiança e compromisso com quem segue em frente.</h1>
          <p>Em Rio Claro/SP, somos mais que um ponto de abastecimento: somos uma parada de segurança, cuidado e acolhimento para a rotina de cada cliente.</p>
        </div>
      </section>

      <section className="container content-section about-story">
        <div className="about-text-card">
          <h2>Uma história construída com trabalho, respeito e qualidade.</h2>
          <p>
            O Posto Via 14 nasceu com o propósito de oferecer uma experiência honesta,
            ágil e confiável para motoristas, famílias, profissionais e viajantes que passam
            por Rio Claro. Cada abastecimento representa o nosso compromisso com a procedência,
            com o bom atendimento e com a tranquilidade de quem confia no nosso serviço.
          </p>
          <p>
            Valorizamos a tradição de atender bem, mas seguimos em constante evolução para entregar
            mais praticidade, estrutura e excelência. Aqui, cada detalhe importa: da qualidade dos
            combustíveis à atenção da equipe, da limpeza do espaço à agilidade no atendimento.
          </p>
          <p>
            Nosso maior orgulho é fazer parte do dia a dia da cidade, recebendo clientes com respeito,
            transparência e o desejo permanente de servir melhor.
          </p>
          <Link to="/contato" className="btn btn--primary">Fale conosco</Link>
        </div>
        <div className="values-grid">
          <article><strong>Confiança</strong><span>Atendimento transparente e compromisso com a qualidade.</span></article>
          <article><strong>Tradição</strong><span>Presença forte em Rio Claro, cuidando de quem passa por aqui.</span></article>
          <article><strong>Excelência</strong><span>Estrutura, produtos e equipe preparados para servir melhor.</span></article>
        </div>
      </section>
    </>
  );
}
