import Icon from './index'
import SITE_CONSTANTS,{EIconsPalettes} from '../../siteConstants'
it('loads the lowercase default palette registry without crashing before SVG loading',()=>{
 const previous=SITE_CONSTANTS.ICONS_PALETTE_FOLDER
 SITE_CONSTANTS.ICONS_PALETTE_FOLDER=EIconsPalettes.Default
 expect(()=>Icon({src:'alarm'})).not.toThrow()
 SITE_CONSTANTS.ICONS_PALETTE_FOLDER=previous
})
it('falls back to default for an unsupported icon palette',()=>{
 const previous=SITE_CONSTANTS.ICONS_PALETTE_FOLDER
 SITE_CONSTANTS.ICONS_PALETTE_FOLDER='unknown' as EIconsPalettes
 expect(()=>Icon({src:'clock'})).not.toThrow()
 SITE_CONSTANTS.ICONS_PALETTE_FOLDER=previous
})
