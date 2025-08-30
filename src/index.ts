import { program } from 'commander';
import { parseYamlConfig,validateConfig } from './config';
import os from 'node:os';
import { createServer } from './server';



async function main(){
    program.option('--config <path>');
    program.parse();

    const options = program.opts();
    //console.log(options);
    
    if( options && 'config' in options){
        const validatedConfig = await validateConfig(await parseYamlConfig(options.config));
        //console.log('Validated Config:', validatedConfig);
        await createServer({port: validatedConfig.server.listen , workerCount: validatedConfig.server.workers ?? os.cpus().length, config: validatedConfig });

    }
}
main();
 