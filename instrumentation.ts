/** Load server jobs only in the Node runtime. Next also compiles this entry for Edge. */
export async function register():Promise<void> {
  if(process.env.NEXT_RUNTIME==='nodejs') {
    const startup=await import('./instrumentation-node');
    await startup.register();
  }
}
