export class SingleFlight {
  private readonly flights = new Map<string, Promise<unknown>>()

  run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const existing = this.flights.get(key)
    if (existing) return existing as Promise<T>

    const flight = operation()
    this.flights.set(key, flight)
    void flight.then(
      () => {
        if (this.flights.get(key) === flight) this.flights.delete(key)
      },
      () => {
        if (this.flights.get(key) === flight) this.flights.delete(key)
      },
    )
    return flight
  }
}
