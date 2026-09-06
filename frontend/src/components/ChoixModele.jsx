import { useEffect, useRef, useState } from 'react';

/**
 * Liste deroulante des modeles, dessinee par l'application.
 *
 * Un <select> natif ouvre un menu rendu par le systeme : ni sa couleur, ni sa
 * surbrillance, ni son espacement ne sont accessibles au CSS. Le resultat
 * jurait avec le reste du portail — un bloc gris sombre au milieu d'une charte
 * bleue. Ce composant reprend donc le comportement d'une liste deroulante en
 * elements ordinaires, seuls stylables.
 *
 * Le clavier reste servi : fleches pour parcourir, Entree pour choisir,
 * Echap pour refermer, et les attributs ARIA annoncent la liste et l'element
 * actif aux lecteurs d'ecran.
 */
function ChoixModele({ id, valeur, options, surChangement, desactive, placeholder }) {
  const [ouvert, setOuvert] = useState(false);
  const [survole, setSurvole] = useState(-1);
  const conteneur = useRef(null);

  // Un clic ailleurs referme : sans cela, la liste resterait ouverte au-dessus
  // du reste du formulaire.
  useEffect(() => {
    if (!ouvert) return undefined;
    const auClic = (e) => {
      if (conteneur.current && !conteneur.current.contains(e.target)) setOuvert(false);
    };
    document.addEventListener('mousedown', auClic);
    return () => document.removeEventListener('mousedown', auClic);
  }, [ouvert]);

  const ouvrir = () => {
    if (desactive) return;
    setSurvole(Math.max(0, options.indexOf(valeur)));
    setOuvert(true);
  };

  const choisir = (option) => {
    surChangement(option);
    setOuvert(false);
  };

  const auClavier = (e) => {
    if (desactive) return;
    if (!ouvert) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        ouvrir();
      }
      return;
    }
    if (e.key === 'Escape') {
      setOuvert(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSurvole((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSurvole((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (options[survole]) choisir(options[survole]);
    }
  };

  return (
    <div className="st-combo" ref={conteneur}>
      <button
        id={id}
        type="button"
        className={`st-combo-champ${ouvert ? ' st-combo-champ--ouvert' : ''}`}
        onClick={() => (ouvert ? setOuvert(false) : ouvrir())}
        onKeyDown={auClavier}
        disabled={desactive}
        aria-haspopup="listbox"
        aria-expanded={ouvert}
      >
        <span className={valeur ? '' : 'st-combo-vide'}>{valeur || placeholder}</span>
        <span className={`st-combo-fleche${ouvert ? ' st-combo-fleche--ouverte' : ''}`} aria-hidden="true" />
      </button>

      {ouvert && (
        <ul className="st-combo-liste" role="listbox" aria-labelledby={id}>
          {options.map((option, i) => (
            <li key={option}>
              <button
                type="button"
                role="option"
                aria-selected={option === valeur}
                className={
                  'st-combo-option'
                  + (option === valeur ? ' st-combo-option--choisie' : '')
                  + (i === survole ? ' st-combo-option--survolee' : '')
                }
                onMouseEnter={() => setSurvole(i)}
                onClick={() => choisir(option)}
              >
                {option}
                {option === valeur && <span className="st-combo-coche" aria-hidden="true">✓</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default ChoixModele;
