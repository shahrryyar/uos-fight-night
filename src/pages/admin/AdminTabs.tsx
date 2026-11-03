import { NavTabs } from '../../components/ui'
import { adminTabs } from './adminNav'
import './AdminTabs.css'


/** `nav.tabs.tabs--5`: five equal columns that all fit at 320px. NavLink sets aria-current="page",
 *  which `.tab[aria-current="page"]` fills bone (static cue, not colour alone). */
export default function AdminTabs() {
  return <NavTabs items={[...adminTabs]} label="Admin sections" />
}
