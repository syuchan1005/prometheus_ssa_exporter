const os = require('os');
const { exec: e } = require('child_process');
const util = require('util');

const exec = util.promisify(e);

const express = require('express');

/* ssacli */
const parseNumberIfPossible = (value/*: string*/)/*: string | number */ => {
  const t = Number(value);
  if (isNaN(t)) return value;
  return t;
}

const convertToObject = (stdout, offsetLine) => {
  const lines = stdout.split('\n').filter((str) => str.trim().length > 0).slice(offsetLine);
  if (lines.length === 0) {
    return [];
  }
  const indexPadding = lines[0].length - lines[0].trimLeft().length;
  const result = [];
  lines.forEach((rawLine) => {
    const line = rawLine.slice(indexPadding);
    if (line.length === 0) {
      return;
    }
    if (line[0] !== ' ') {
      result.push({ name: line });
    } else if (result.length > 0) {
      const e = line.split(': ');
      result[result.length - 1][e[0].trim()] = parseNumberIfPossible(e[1]);
    }
  });

  return result;
};

const getControllers = async () => {
  const controllerResult = await exec('ssacli ctrl all show detail');
  return convertToObject(controllerResult.stdout, 0);
};

const getArrays = async (controllerSlot) => {
  const arrayResult = await exec(`ssacli ctrl slot=${controllerSlot} array all show detail`);
  return convertToObject(arrayResult.stdout, 1);
};

/**
 * { controllerSlot, arrays: { A: { convertedJSON } } }
 */
const getPhysicalDrives = async (controllerSlot) => {
  const pdResult = await exec(`ssacli ctrl slot=${controllerSlot} pd all show detail`);
  const lines = pdResult.stdout.split('\n').filter((str) => str.trim().length > 0).slice(1);
  const arrayLabelIndent = lines[0].length - lines[0].trimLeft().length;
  const arraySeparatedLines = [];
  lines.forEach((rawLine) => {
    const line = rawLine.slice(arrayLabelIndent);
    if (line[0] !== ' ') {
      arraySeparatedLines.push([line]);
    } else {
      arraySeparatedLines[arraySeparatedLines.length - 1].push(line);
    }
  });
  const result = { controllerSlot, arrays: {} };
  arraySeparatedLines.forEach((lines) => {
    const splittedArrayLabel = lines.shift().split(" ");
    const arrayLabel = splittedArrayLabel[1] || splittedArrayLabel[0];
    const pdLabelIndent = lines[0].length - lines[0].trimLeft().length;
    result.arrays[arrayLabel] = convertToObject(lines.map((str) => str.slice(pdLabelIndent)).join('\n'));
  });
  return result;
};

const statusToInt = (str) => (str === 'OK' ? 1 : 0);

const makeControllerMetrics = async (controllers) => {
  const lines = [];

  const controllerStatusKey = 'ssa_controller_status';
  lines.push(
    `# HELP ${controllerStatusKey} Controller status (OK = 1)`,
    `# TYPE ${controllerStatusKey} gauge`,
    ...controllers.map((controller) => `${controllerStatusKey}{hostname="${os.hostname()}",slot="${controller.Slot}",serial="${controller['Serial Number']}"} ${statusToInt(controller['Controller Status'])}`),
  );

  const controllerTemperatureKey = 'ssa_controller_temperature';
  lines.push(
    `# HELP ${controllerTemperatureKey} Controller temperature`,
    `# TYPE ${controllerTemperatureKey} gauge`,
    ...controllers.map((controller) => `${controllerTemperatureKey}{hostname="${os.hostname()}",slot="${controller.Slot}",serial="${controller['Serial Number']}"} ${controller['Controller Temperature (C)']}`)
  );

  const controllerCacheModuleTemperatureKey = 'ssa_controller_cacheModule_temperature';
  lines.push(
    `# HELP ${controllerCacheModuleTemperatureKey} Controller cache module temperature`,
    `# TYPE ${controllerCacheModuleTemperatureKey} gauge`,
    ...controllers.map((controller) => `${controllerCacheModuleTemperatureKey}{hostname="${os.hostname()}",slot="${controller.Slot}",serial="${controller['Serial Number']}"} ${controller['Cache Module Temperature (C)']}`)
  );

  return lines;
};

const makeArrayMetrics = async (controllers) => {
  const controllerArrays = await Promise.all(controllers.map(
    (controller) => getArrays(controller.Slot).then((arrays) => ({ controller, arrays })),
  ));

  const lines = [];

  const arrayStatusKey = 'ssa_array_status';
  lines.push(
    `# HELP ${arrayStatusKey} Array status (OK = 1)`,
    `# TYPE ${arrayStatusKey} gauge`,
    ...controllerArrays.flatMap(({ controller, arrays }) =>
      arrays.map((array) => `${arrayStatusKey}{hostname="${os.hostname()}",slot="${controller.Slot}",serial="${controller['Serial Number']}",array="${array.name.substr('Arrays:'.length)}"} ${statusToInt(array.Status)}`)),
  );

  const arrayMultiDomainStatusKey = 'ssa_array_multiDomain_status';
  lines.push(
    `# HELP ${arrayMultiDomainStatusKey} Array multi domain status (OK = 1)`,
    `# TYPE ${arrayMultiDomainStatusKey} gauge`,
    ...controllerArrays.flatMap(({ controller, arrays }) =>
      arrays.map((array) => `${arrayMultiDomainStatusKey}{hostname="${os.hostname()}",slot="${controller.Slot}",serial="${controller['Serial Number']}",array="${array.name.substr('Arrays:'.length)}"} ${statusToInt(array['MultiDomain Status'])}`)),
  );

  return lines;
};

const makePhysicalDriveMetrics = async (controllers) => {
  const controllerDrives = await Promise.all(controllers.map(
    (controller) => getPhysicalDrives(controller.Slot).then(({ arrays }) => ({ controller, arrays })),
  ));

  const lines = [];

  const driveStatusKey = 'ssa_physicalDrive_status';
  lines.push(
    `# HELP ${driveStatusKey} Physical drive status (OK = 1)`,
    `# TYPE ${driveStatusKey} gauge`,
    ...controllerDrives.flatMap(({ controller, arrays}) =>
      Object.entries(arrays).flatMap(([arrayLabel, drives]) =>
        drives.map((drive) => `${driveStatusKey}{hostname="${os.hostname()}",slot="${controller.Slot}",serial="${controller['Serial Number']}",array="${arrayLabel}",drivePort="${drive.Port}",driveBox="${drive.Box}",driveBay="${drive.Bay}"} ${statusToInt(drive.Status)}`)
      ),
    ),
  );

  const driveTemperatureKey = 'ssa_physicalDrive_temperature';
  lines.push(
    `# HELP ${driveTemperatureKey} Physical drive temperature`,
    `# TYPE ${driveStatusKey} gauge`,
    ...controllerDrives.flatMap(({ controller, arrays}) =>
      Object.entries(arrays).flatMap(([arrayLabel, drives]) =>
        drives.map((drive) => `${driveTemperatureKey}{hostname="${os.hostname()}",slot="${controller.Slot}",serial="${controller['Serial Number']}",array="${arrayLabel}",drivePort="${drive.Port}",driveBox="${drive.Box}",driveBay="${drive.Bay}"} ${drive['Current Temperature (C)']}`)
      ),
    ),
  );

  return lines;
};


const getMetrics = async () => {
  const controllers = await getControllers();
  const metrics = [
    (await makeControllerMetrics(controllers)),
    (await makeArrayMetrics(controllers)),
    (await makePhysicalDriveMetrics(controllers)),
  ]
    .flat()
    .join('\n');

  return metrics + '\n';
};


const app = express();

app.get('/', (req, res) => {
  res.send('<html><head><title>SSA Exporter</title></head><body><h1>SSA Exporter</h1><p><a href="/metrics">Metrics</a></p></body></html>')
});
app.get('/metrics', async (req, res) => {
  res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.send(await getMetrics());
});

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`listen :${port}`);
});

