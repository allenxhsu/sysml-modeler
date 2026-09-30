// The worked example the app opens on: a small electric vehicle.

import { createModel, addElement, addRelationship, addDiagram, addSymbol } from './model.js';

export function sampleModel() {
  const m = createModel('Vehicle model');
  const root = m.rootId;
  const pkg = (name, owner = root) => addElement(m, 'package', owner, { name });
  const structure = pkg('Structure');
  const types = pkg('Value types', structure.id);
  const reqs = pkg('Requirements');
  const ucs = pkg('Use cases');
  const tests = pkg('Verification');

  const vt = (name, unit) => addElement(m, 'valueType', types.id, { name, unit });
  const kg = vt('kg', 'kilogram'); const km = vt('km', 'kilometre'); const kW = vt('kW', 'kilowatt'); const kWh = vt('kWh', 'kilowatt hour');

  const block = (name, doc = '') => addElement(m, 'block', structure.id, { name, doc });
  const vehicle = block('Vehicle', 'Top-level system of interest.');
  const powertrain = block('Powertrain');
  const battery = block('Battery');
  const motor = block('Motor');
  const chassis = block('Chassis');
  const power = block('DC power', 'Interface block for the high-voltage bus.');

  const value = (owner, name, type, defaultValue = '') => addElement(m, 'property', owner.id, { name, propKind: 'value', typeId: type.id, defaultValue });
  value(vehicle, 'mass', kg); value(vehicle, 'range', km);
  value(battery, 'capacity', kWh, '75'); value(battery, 'mass', kg);
  value(motor, 'peakPower', kW, '210');
  const part = (owner, name, type, multiplicity = '1') => addElement(m, 'property', owner.id, { name, propKind: 'part', typeId: type.id, multiplicity });
  part(vehicle, 'powertrain', powertrain); part(vehicle, 'chassis', chassis);
  const pBattery = part(powertrain, 'battery', battery);
  const pMotor = part(powertrain, 'motor', motor, '1..2');
  addElement(m, 'operation', vehicle.id, { name: 'drive', params: 'distance : km' });
  const port = (owner, name, direction) => addElement(m, 'port', owner.id, { name, direction, typeId: power.id });
  const battOut = port(battery, 'hvOut', 'out');
  const motorIn = port(motor, 'hvIn', 'in');
  const chargeIn = port(powertrain, 'charge', 'in');
  const battIn = port(battery, 'chargeIn', 'in');

  const req = (owner, name, text) => addElement(m, 'requirement', owner, { name, text });
  const r1 = req(reqs.id, 'Max range', 'The vehicle shall travel at least 500 km on a full charge.');
  const r11 = req(r1.id, 'Battery capacity', 'The battery shall store at least 75 kWh of usable energy.');
  const r2 = req(reqs.id, 'Curb mass', 'The vehicle curb mass shall not exceed 2100 kg.');
  const r3 = req(reqs.id, 'Acceleration', 'The vehicle shall accelerate from 0 to 100 km/h in under 6 s.');
  const rangeTest = addElement(m, 'testCase', tests.id, { name: 'Range test', doc: 'WLTP cycle on a chassis dynamometer.' });

  addRelationship(m, 'satisfy', vehicle.id, r1.id);
  addRelationship(m, 'satisfy', battery.id, r11.id);
  addRelationship(m, 'satisfy', vehicle.id, r2.id);
  addRelationship(m, 'deriveReqt', r11.id, r1.id);
  addRelationship(m, 'verify', rangeTest.id, r1.id);

  const driver = addElement(m, 'actor', ucs.id, { name: 'Driver' });
  const charger = addElement(m, 'actor', ucs.id, { name: 'Charging station' });
  const uc = (name) => addElement(m, 'useCase', ucs.id, { name });
  const drive = uc('Drive vehicle'); const charge = uc('Charge battery'); const auth = uc('Authenticate driver'); const regen = uc('Recover braking energy');
  addRelationship(m, 'association', driver.id, drive.id);
  addRelationship(m, 'association', driver.id, charge.id);
  addRelationship(m, 'association', charger.id, charge.id);
  addRelationship(m, 'include', drive.id, auth.id);
  addRelationship(m, 'extend', regen.id, drive.id);
  addRelationship(m, 'refine', drive.id, r1.id);

  addRelationship(m, 'connector', pBattery.id, pMotor.id, { ownerId: powertrain.id, sourcePortId: battOut.id, targetPortId: motorIn.id });
  addRelationship(m, 'connector', null, pBattery.id, { ownerId: powertrain.id, sourcePortId: chargeIn.id, targetPortId: battIn.id });

  const place = (d, list) => { for (const [e, x, y, w] of list) { const s = addSymbol(m, d, e.id, x, y); if (w) s.w = w; } };

  const bdd = addDiagram(m, 'bdd', structure.id, 'Vehicle structure');
  place(bdd, [[vehicle, 300, 70], [powertrain, 140, 300], [chassis, 480, 300], [battery, 40, 500], [motor, 270, 500], [power, 560, 480]]);

  const ibd = addDiagram(m, 'ibd', powertrain.id, 'Powertrain internals', { contextId: powertrain.id });
  place(ibd, [[pBattery, 160, 160, 200], [pMotor, 520, 160, 200]]);

  const rd = addDiagram(m, 'req', reqs.id, 'Vehicle requirements');
  place(rd, [[r1, 330, 70], [r11, 330, 330], [vehicle, 70, 90], [r2, 40, 330], [rangeTest, 680, 80, 190], [battery, 690, 350], [r3, 680, 210]]);
  rd.symbols.forEach((s) => { if (m.elements[s.elementId].kind === 'block') s.hide = { values: true, parts: true, ports: true, operations: true, references: true }; });

  const ud = addDiagram(m, 'uc', ucs.id, 'Vehicle use cases');
  const subj = addSymbol(m, ud, vehicle.id, 230, 60); subj.w = 440; subj.h = 430;
  place(ud, [[driver, 80, 150], [charger, 760, 340], [drive, 270, 110], [auth, 460, 230], [regen, 250, 250], [charge, 370, 390]]);

  // Behaviour: how charging goes, as a sequence over the structure above.
  const beh = pkg('Behaviour');
  const ia = addElement(m, 'interaction', beh.id, { name: 'Charge battery', doc: 'The driver plugs in; the vehicle negotiates with the station and charges the battery until full.' });
  const line = (name, rep) => addElement(m, 'lifeline', ia.id, { name, representsId: rep.id });
  const lDriver = line('driver', driver); const lVehicle = line('vehicle', vehicle); const lStation = line('station', charger); const lBattery = line('battery', battery);
  const msg = (from, to, name, msgKind = 'sync') => addElement(m, 'message', ia.id, { name, msgKind, fromId: from.id, toId: to.id });
  msg(lDriver, lVehicle, 'plugIn');
  msg(lVehicle, lStation, 'requestCharge(kW)', 'async');
  msg(lStation, lVehicle, 'offer', 'reply');
  msg(lVehicle, lBattery, 'startCharging');
  msg(lBattery, lBattery, 'monitorCells');
  msg(lBattery, lVehicle, 'charged', 'reply');
  msg(lVehicle, lDriver, 'notify', 'async');
  addElement(m, 'fragment', ia.id, { operator: 'loop', operands: [{ guard: 'until full' }], coveredIds: [lVehicle.id, lBattery.id], fromSeq: 4, toSeq: 6 });
  addElement(m, 'fragment', ia.id, { operator: 'opt', operands: [{ guard: 'driver present' }], coveredIds: [lDriver.id, lVehicle.id], fromSeq: 7, toSeq: 7 });
  const sd = addDiagram(m, 'sd', ia.id, 'Charging sequence', { contextId: ia.id });
  [lDriver, lVehicle, lStation, lBattery].forEach((l, i) => addSymbol(m, sd, l.id, 60 + i * 210, 0));

  addDiagram(m, 'reqtable', reqs.id, 'Requirement table');
  addDiagram(m, 'matrix', reqs.id, 'Satisfy matrix', { relKind: 'satisfy', rowKind: 'block', colKind: 'requirement' });
  return m;
}
