import {createRoot} from 'react-dom/client';
import P5ProcessingStatus from '../../components/P5ProcessingStatus';
import {type ProcessingStatus} from '../../lib/p5/processingStatus';
import styles from '../../components/P5Estimator.module.css';
const phase=new URLSearchParams(window.location.search).get('phase');
const status:ProcessingStatus=phase==='research'?{phase:'research',message:'Checking published cost evidence for items that need a supported allowance.',currentItems:['First-floor solid-core doors and black hardware','Well installation allowance'] ,updatedAt:new Date().toISOString(),startedAt:new Date(Date.now()-140000).toISOString()}:{phase:'reading',message:'Read 96 of 256 original pages; 12 of 32 sections processed. Checking drawings, schedules and scope.',readPages:96,totalPages:256,readSections:12,totalSections:32,currentItems:['Main-building-plans.pdf (pages 97 to 104 of 256)','Main-building-plans.pdf (pages 105 to 112 of 256)'],updatedAt:new Date().toISOString(),startedAt:new Date(Date.now()-65000).toISOString()};
createRoot(document.getElementById('root')!).render(<main className={styles.root} style={{'--p5-accent':'#e8b65c'} as React.CSSProperties}><p>Development preview with simulated progress. No live estimate.</p><P5ProcessingStatus message={status.message} processing={status} uploadPercent={null}/></main>);
