/** Ersatz für „node:dgram“: Im Browser gibt es keine Suche im LAN per UDP. */

const dgram = {
  createSocket: (): never => {
    throw new Error('Keine Suche im LAN im Browser')
  },
}

export default dgram
