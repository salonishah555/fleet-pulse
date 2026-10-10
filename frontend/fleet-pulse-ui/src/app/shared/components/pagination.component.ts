import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';

@Component({
  selector: 'app-pagination',
  imports: [MatButtonModule],
  template: `
    <nav class="pager" aria-label="Services pagination">
      <span>Showing {{ firstItem() }} - {{ lastItem() }} of {{ totalItems() }} · Page {{ page() }} of {{ pageCount() }}</span>
      <div class="pager-actions">
        <button matButton="outlined" type="button" aria-label="Previous page" (click)="previous.emit()" [disabled]="page() === 1">Previous</button>
        <button matButton="outlined" type="button" aria-label="Next page" (click)="next.emit()" [disabled]="page() === pageCount()">Next</button>
      </div>
    </nav>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PaginationComponent {
  readonly page = input.required<number>();
  readonly pageCount = input.required<number>();
  readonly firstItem = input.required<number>();
  readonly lastItem = input.required<number>();
  readonly totalItems = input.required<number>();
  readonly previous = output<void>();
  readonly next = output<void>();
}
