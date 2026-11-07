// Standalone loader compatibility fixture: no App bootstrap or backend calls.
import React, {useState} from 'react'
import {createRoot} from 'react-dom/client'
import Icon from '../components/Icon'
import {names} from '../constants/icons'
import SITE_CONSTANTS, {EIconsPalettes} from '../siteConstants'
import ordinarySvg from '../assets/icons/default/alarm.svg'
import css from './fixtures/style-probe.module.css'
import sass from './fixtures/style-probe.module.scss'
import '../design/rsale.css'
import './fixtures/style-probe.scss'
import './fixtures/style-probe.sass'

function Fixture() {
  const [palette, setPalette] = useState(EIconsPalettes.Default)
  SITE_CONSTANTS.ICONS_PALETTE_FOLDER = palette
  return <main className="pipeline-fixture">
    <h1>CSS / SVG compatibility</h1>
    <p>Local build fixture. No orders or remote configuration.</p>
    <div className="probe-row">
      {Object.values(EIconsPalettes).map(value => <button type="button" key={value} data-testid={'palette-'+value} onClick={() => setPalette(value)}>{value}</button>)}
    </div>
    <section data-testid="icons" className="icon-grid" key={palette}>
      {(Object.keys(names) as Array<keyof typeof names>).map(name => <article className="icon-cell" data-icon={name} key={name}>
        <Icon src={name} width="36" height="36" stroke="#a90000" aria-label={name}/><small>{name}</small>
      </article>)}
    </section>
    <div className="probe-row">
      <article data-testid="css-module" className={css.moduleCard}>CSS module</article>
      <article data-testid="sass-module" className={sass.sassCard}><span className={sass.nested}>Sass module</span></article>
      <article data-testid="indented" className="indented-sass">Indented Sass</article>
    </div>
    <div className="probe-row">
      <img data-testid="ordinary-svg" src={ordinarySvg} width="36" height="36" alt="URL asset"/>
      <div data-testid="relative-icon" className="relative-icon"/>
      <div data-testid="public-car" className="public-car"/>
    </div>
  </main>
}
createRoot(document.getElementById('root')!).render(<Fixture/>)
