import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

@Component({
  selector: 'app-pagination',
  template: `
    <footer class="pager">
      <button type="button" (click)="previous.emit()" [disabled]="page() === 1">Previous</button>
      <span>Page {{ page() }} of {{ pageCount() }}</span>
      <button type="button" (click)="next.emit()" [disabled]="page() === pageCount()">Next</button>
    </footer>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PaginationComponent {
  readonly page = input.required<number>();
  readonly pageCount = input.required<number>();
  readonly previous = output<void>();
  readonly next = output<void>();
}
