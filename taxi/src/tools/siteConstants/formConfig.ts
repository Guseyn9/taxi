export class PassengerOrderConfig {
  visibility: {
    fromWay: boolean,
    toWay: boolean,
    fromMission: boolean,
    toMission: boolean,
    cost: boolean
  }
  values: {
    weight: {id: string}[]
  }

  constructor(config?: string) {
    this.visibility = {
      fromWay: true,
      toWay: true,
      fromMission: true,
      toMission: true,
      cost: true,
    }

    this.values = {
      weight: [
        { id: '50' },
        { id: '100' },
        { id: '150' },
        { id: '200' },
      ],
    }

    if (config) {this.apply(config)}
  }

  apply(config?: string) {
    if (!config) return

    let _config

    try {
      _config = JSON.parse(config)
    } catch (e) {
      return
    }

    if (!_config || typeof _config !== 'object' || Array.isArray(_config)) return
    for (const key of Object.keys(this.visibility) as (keyof PassengerOrderConfig['visibility'])[]) {
      if (typeof _config.visibility?.[key] === 'boolean') this.visibility[key] = _config.visibility[key]
    }
    const weight = _config.values?.weight
    if (Array.isArray(weight) && weight.every(item => item && typeof item.id === 'string'))
      this.values.weight = weight.map(item => ({ id: item.id }))
  }
}
